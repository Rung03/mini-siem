// เทสต์ parser ของทุกแหล่งข้อมูล

import { describe, expect, it } from 'vitest';
import { normalize } from '../src/normalize/index.js';
import type { SourceType } from '../src/normalize/schema.js';

const receivedAt = new Date('2026-09-12T12:00:00Z');

function run(sourceType: SourceType, raw: string, json?: unknown) {
  return normalize(sourceType, { raw, json, receivedAt, peerIp: '10.0.0.9' });
}

describe('fortigate', () => {
  const line =
    'date=2026-09-12 time=09:14:22 devname="FG100E" devid="FG100ETK18001234" ' +
    'logid="0100032002" type="event" subtype="system" level="alert" vd="root" ' +
    'logdesc="Admin login failed" user="admin" ui="https(203.0.113.44)" ' +
    'srcip=203.0.113.44 action="login" status="failed" reason="name_invalid" ' +
    'msg="Administrator admin login failed from https(203.0.113.44)"';

  it('reads a failed admin login', () => {
    const e = run('fortigate', line);
    expect(e.parseOk).toBe(true);
    expect(e.eventOutcome).toBe('failure');
    expect(e.eventCategory).toBe('authentication');
    expect(e.userName).toBe('admin');
    expect(e.srcIp).toBe('203.0.113.44');
    expect(e.host).toBe('FG100E');
    expect(e.ts.toISOString()).toBe('2026-09-12T09:14:22.000Z');
  });

  it('reads a successful login and keeps the raw line', () => {
    const ok = line.replace('status="failed"', 'status="success"');
    const e = run('fortigate', ok);
    expect(e.eventOutcome).toBe('success');
    expect(e.raw).toBe(ok);
  });

  it('survives a syslog priority prefix', () => {
    const e = run('fortigate', `<190>${line}`);
    expect(e.eventOutcome).toBe('failure');
    expect(e.userName).toBe('admin');
  });
});

describe('windows_ad', () => {
  it('maps 4625 to a failed login with a readable reason', () => {
    const e = run(
      'windows_ad',
      JSON.stringify({
        EventID: 4625,
        TimeCreated: '2026-09-12T09:15:00Z',
        Computer: 'DC-01.corp.local',
        TargetUserName: 'CORP\\jsmith',
        IpAddress: '203.0.113.44',
        LogonType: 3,
        SubStatus: '0xc000006a',
      }),
    );
    expect(e.eventOutcome).toBe('failure');
    expect(e.eventAction).toBe('login');
    expect(e.userName).toBe('jsmith');
    expect(e.attrs.domain).toBe('CORP');
    expect(e.attrs.reason).toBe('wrong password');
    expect(e.attrs.logon_type_name).toBe('network');
  });

  it('maps 4624 to a successful login', () => {
    const e = run(
      'windows_ad',
      JSON.stringify({ EventID: 4624, TargetUserName: 'apatel', IpAddress: '10.10.0.5' }),
    );
    expect(e.eventOutcome).toBe('success');
    expect(e.userName).toBe('apatel');
  });

  it('falls back to the rendered text form', () => {
    const text = [
      'An account failed to log on.',
      '',
      'Subject:',
      '\tAccount Name:\t\tDC-01$',
      'Account For Which Logon Failed:',
      '\tAccount Name:\t\tadministrator',
      'Network Information:',
      '\tSource Network Address:\t203.0.113.66',
      '\tLogon Type:\t3',
    ].join('\n');

    const e = run('windows_ad', text);
    expect(e.eventOutcome).toBe('failure');
    expect(e.srcIp).toBe('203.0.113.66');
  });

  it('flags a payload with no event id rather than dropping it', () => {
    const e = run('windows_ad', 'something else entirely');
    expect(e.parseOk).toBe(false);
    expect(e.raw).toBe('something else entirely');
  });
});

describe('m365', () => {
  it('reads a failed sign-in', () => {
    const e = run(
      'm365',
      JSON.stringify({
        CreationTime: '2026-09-12T09:16:00',
        Operation: 'UserLoginFailed',
        ResultStatus: 'Failed',
        UserId: 'jsmith@contoso.com',
        ClientIP: '203.0.113.44',
        LogonError: 'InvalidUserNameOrPassword',
        Workload: 'AzureActiveDirectory',
      }),
    );
    expect(e.eventOutcome).toBe('failure');
    expect(e.userName).toBe('jsmith@contoso.com');
    expect(e.attrs.reason).toBe('invalid user name or password');
    expect(e.ts.toISOString()).toBe('2026-09-12T09:16:00.000Z');
  });

  it('reads a successful sign-in', () => {
    const e = run(
      'm365',
      JSON.stringify({ Operation: 'UserLoggedIn', ResultStatus: 'Success', UserId: 'a@b.com' }),
    );
    expect(e.eventOutcome).toBe('success');
  });
});

describe('aws_cloudtrail', () => {
  it('reads a failed console login', () => {
    const e = run(
      'aws_cloudtrail',
      JSON.stringify({
        eventTime: '2026-09-12T09:17:00Z',
        eventSource: 'signin.amazonaws.com',
        eventName: 'ConsoleLogin',
        sourceIPAddress: '198.51.100.23',
        userIdentity: { type: 'IAMUser', userName: 'deploy-bot', accountId: '123456789012' },
        responseElements: { ConsoleLogin: 'Failure' },
        errorMessage: 'Failed authentication',
      }),
    );
    expect(e.eventOutcome).toBe('failure');
    expect(e.userName).toBe('deploy-bot');
    expect(e.srcIp).toBe('198.51.100.23');
    expect(e.eventCategory).toBe('authentication');
  });

  it('keeps an AWS service principal out of the ip column', () => {
    const e = run(
      'aws_cloudtrail',
      JSON.stringify({
        eventName: 'ConsoleLogin',
        sourceIPAddress: 'cloudformation.amazonaws.com',
        responseElements: { ConsoleLogin: 'Success' },
      }),
    );
    expect(e.srcIp).toBeNull();
    expect(e.attrs.source).toBe('cloudformation.amazonaws.com');
  });
});

describe('crowdstrike', () => {
  it('reads a failed console authentication', () => {
    const e = run(
      'crowdstrike',
      JSON.stringify({
        metadata: { eventType: 'UserActivityAuditEvent', eventCreationTime: 1_789_000_000_000 },
        event: {
          UserId: 'analyst@corp.local',
          UserIp: '203.0.113.44',
          OperationName: 'user_authenticate',
          Success: false,
        },
      }),
    );
    expect(e.eventOutcome).toBe('failure');
    expect(e.eventCategory).toBe('authentication');
    expect(e.userName).toBe('analyst@corp.local');
  });

  it('reads a detection', () => {
    const e = run(
      'crowdstrike',
      JSON.stringify({
        metadata: { eventType: 'DetectionSummaryEvent', eventCreationTime: 1_789_000_000_000 },
        event: {
          DetectName: 'Credential Dumping',
          SeverityName: 'High',
          ComputerName: 'WS-114',
          UserName: 'mchen',
        },
      }),
    );
    expect(e.eventCategory).toBe('detection');
    expect(e.severity).toBe(8);
    expect(e.host).toBe('WS-114');
  });
});

describe('generic', () => {
  it('recognises an sshd failure', () => {
    const e = run(
      'generic',
      '<38>Sep 12 09:18:22 web-01 sshd[2411]: Failed password for invalid user admin from 203.0.113.66 port 52344 ssh2',
    );
    expect(e.eventOutcome).toBe('failure');
    expect(e.eventCategory).toBe('authentication');
    expect(e.userName).toBe('admin');
    expect(e.srcIp).toBe('203.0.113.66');
    expect(e.attrs.program).toBe('sshd');
    expect(e.srcPort).toBe(52344);
    expect(e.source).toBe('network');
    expect(e.action).toBe('login');
  });

  it('recognises an sshd success', () => {
    const e = run(
      'generic',
      '<38>Sep 12 09:19:02 web-01 sshd[2412]: Accepted password for jsmith from 10.0.0.5 port 51234 ssh2',
    );
    expect(e.eventOutcome).toBe('success');
    expect(e.userName).toBe('jsmith');
  });

  it('accepts an in-house application JSON shape', () => {
    const e = run(
      'generic',
      JSON.stringify({
        timestamp: '2026-09-12T09:20:00Z',
        user: 'svance',
        client_ip: '10.10.0.31',
        action: 'login',
        result: 'failed',
        message: 'bad password',
        app: 'billing',
      }),
    );
    expect(e.eventOutcome).toBe('failure');
    expect(e.userName).toBe('svance');
    expect(e.srcIp).toBe('10.10.0.31');
    expect(e.product).toBe('billing');
    expect(e.source).toBe('api');
  });

  it('hands a firewall key=value line to the firewall parser', () => {
    const e = run(
      'generic',
      '<134>Aug 20 12:44:56 fw01 vendor=demo product=ngfw action=deny ' +
        'src=10.0.1.10 dst=8.8.8.8 spt=5353 dpt=53 proto=udp msg=DNS blocked policy=Block-DNS',
    );
    expect(e.parseOk).toBe(true);
    expect(e.source).toBe('firewall');
    expect(e.sourceType).toBe('fortigate');
    expect(e.action).toBe('deny');
    expect(e.dstPort).toBe(53);
    expect(e.ruleName).toBe('Block-DNS');
  });

  it('hands a FortiGate event line to the firewall parser', () => {
    const e = run(
      'generic',
      '<190>date=2026-09-12 time=09:14:22 devname="FG100E" logid="0100032002" type="event" ' +
        'subtype="system" level="alert" logdesc="Admin login failed" user="admin" ' +
        'srcip=203.0.113.66 action="login" status="failed"',
    );
    expect(e.source).toBe('firewall');
    expect(e.eventCategory).toBe('authentication');
    expect(e.eventOutcome).toBe('failure');
    expect(e.userName).toBe('admin');
  });

  it('keeps sshd lines that mention src= on the login path', () => {
    const e = run(
      'generic',
      '<38>Sep 12 09:18:22 web-01 sshd[2411]: Failed password for root from 203.0.113.66 port 22 ssh2 src=1.2.3.4 dst=5.6.7.8 action=x',
    );
    expect(e.source).toBe('network');
    expect(e.eventCategory).toBe('authentication');
  });

  it('still stores a line it cannot classify', () => {
    const e = run('generic', '<38>Sep 12 09:21:00 web-01 kernel: usb 1-1: new device');
    expect(e.parseOk).toBe(true);
    expect(e.eventOutcome).toBe('unknown');
    expect(e.raw).toContain('new device');
  });
});

describe('every parser', () => {
  const sources: SourceType[] = [
    'fortigate', 'windows_ad', 'm365', 'aws_cloudtrail', 'crowdstrike', 'generic',
  ];

  it.each(sources)('%s keeps the raw payload intact', (source) => {
    const raw = 'total nonsense — not this format at all';
    const e = run(source, raw);
    expect(e.raw).toBe(raw);
    expect(e.ts).toBeInstanceOf(Date);
  });

  it.each(sources)('%s never throws on empty input', (source) => {
    expect(() => run(source, '')).not.toThrow();
  });
});

describe('assignment sample payloads', () => {
  it('4.1 firewall syslog', () => {
    const e = run(
      'fortigate',
      '<134>Aug 20 12:44:56 fw01 vendor=demo product=ngfw action=deny ' +
        'src=10.0.1.10 dst=8.8.8.8 spt=5353 dpt=53 proto=udp msg=DNS blocked ' +
        'policy=Block-DNS',
    );
    expect(e.parseOk).toBe(true);
    expect(e.source).toBe('firewall');
    expect(e.vendor).toBe('demo');
    expect(e.product).toBe('ngfw');
    expect(e.action).toBe('deny');
    expect(e.eventOutcome).toBe('failure');
    expect(e.srcIp).toBe('10.0.1.10');
    expect(e.dstIp).toBe('8.8.8.8');
    expect(e.srcPort).toBe(5353);
    expect(e.dstPort).toBe(53);
    expect(e.protocol).toBe('udp');
    expect(e.ruleName).toBe('Block-DNS');
  });

  it('4.2 router syslog', () => {
    const e = run(
      'generic',
      '<190>Aug 20 13:01:02 r1 if=ge-0/0/1 event=link-down ' +
        'mac=aa:bb:cc:dd:ee:ff reason=carrier-loss',
    );
    expect(e.parseOk).toBe(true);
    expect(e.source).toBe('network');
    expect(e.eventType).toBe('link-down');
    expect(e.host).toBe('r1');
    expect(e.attrs.reason).toBe('carrier-loss');
    expect(e.attrs.interface).toBe('ge-0/0/1');
  });

  it('4.3 HTTP API JSON', () => {
    const e = run(
      'generic',
      JSON.stringify({
        tenant: 'demoA',
        source: 'api',
        event_type: 'app_login_failed',
        user: 'alice',
        ip: '203.0.113.7',
        reason: 'wrong_password',
        '@timestamp': '2025-08-20T07:20:00Z',
      }),
    );
    expect(e.parseOk).toBe(true);
    expect(e.source).toBe('api');
    expect(e.eventType).toBe('app_login_failed');
    expect(e.action).toBe('login');
    expect(e.eventOutcome).toBe('failure');
    expect(e.userName).toBe('alice');
    expect(e.srcIp).toBe('203.0.113.7');
    expect(e.ts.toISOString()).toBe('2025-08-20T07:20:00.000Z');
    expect(e.attrs.claimed_tenant).toBe('demoA');
  });

  it('4.4 CrowdStrike sample', () => {
    const e = run(
      'crowdstrike',
      JSON.stringify({
        tenant: 'demoA',
        source: 'crowdstrike',
        event_type: 'malware_detected',
        host: 'WIN10-01',
        process: 'powershell.exe',
        severity: 8,
        sha256: 'abc...',
        action: 'quarantine',
        '@timestamp': '2025-08-20T08:00:00Z',
      }),
    );
    expect(e.parseOk).toBe(true);
    expect(e.source).toBe('crowdstrike');
    expect(e.eventType).toBe('malware_detected');
    expect(e.host).toBe('WIN10-01');
    expect(e.process).toBe('powershell.exe');
    expect(e.severity).toBe(8);
    expect(e.eventCategory).toBe('detection');
    expect(e.attrs.sha256).toBe('abc...');
  });

  it('4.5 AWS CloudTrail sample', () => {
    const e = run(
      'aws_cloudtrail',
      JSON.stringify({
        tenant: 'demoB',
        source: 'aws',
        cloud: { service: 'iam', account_id: '123456789012', region: 'ap-southeast-1' },
        event_type: 'CreateUser',
        user: 'admin',
        '@timestamp': '2025-08-20T09:10:00Z',
        raw: { eventName: 'CreateUser', requestParameters: { userName: 'temp-user' } },
      }),
    );
    expect(e.parseOk).toBe(true);
    expect(e.source).toBe('aws');
    expect(e.eventType).toBe('CreateUser');
    expect(e.action).toBe('create');
    expect(e.userName).toBe('admin');
    expect(e.cloudService).toBe('iam');
    expect(e.cloudAccountId).toBe('123456789012');
    expect(e.cloudRegion).toBe('ap-southeast-1');
  });

  it('4.6 Microsoft 365 sample', () => {
    const e = run(
      'm365',
      JSON.stringify({
        tenant: 'demoB',
        source: 'm365',
        event_type: 'UserLoggedIn',
        user: 'bob@demo.local',
        ip: '198.51.100.23',
        status: 'Success',
        workload: 'Exchange',
        '@timestamp': '2025-08-20T10:05:00Z',
      }),
    );
    expect(e.parseOk).toBe(true);
    expect(e.source).toBe('m365');
    expect(e.eventType).toBe('UserLoggedIn');
    expect(e.action).toBe('login');
    expect(e.eventOutcome).toBe('success');
    expect(e.userName).toBe('bob@demo.local');
    expect(e.srcIp).toBe('198.51.100.23');
    expect(e.attrs.workload).toBe('Exchange');
  });

  it('4.7 Windows AD sample', () => {
    const e = run(
      'windows_ad',
      JSON.stringify({
        tenant: 'demoA',
        source: 'ad',
        event_id: 4625,
        event_type: 'LogonFailed',
        user: 'demo\\eve',
        host: 'DC01',
        ip: '203.0.113.77',
        logon_type: 3,
        '@timestamp': '2025-08-20T11:11:11Z',
      }),
    );
    expect(e.parseOk).toBe(true);
    expect(e.source).toBe('ad');
    expect(e.eventType).toBe('LogonFailed');
    expect(e.action).toBe('login');
    expect(e.eventOutcome).toBe('failure');
    expect(e.userName).toBe('eve');
    expect(e.attrs.domain).toBe('demo');
    expect(e.host).toBe('DC01');
    expect(e.srcIp).toBe('203.0.113.77');
    expect(e.attrs.logon_type_name).toBe('network');
  });

  it('keeps severity inside the 0-10 range section 3 specifies', () => {
    for (const source of SOURCES_UNDER_TEST) {
      const e = run(source, 'nonsense that no parser understands');
      expect(e.severity === null || (e.severity >= 0 && e.severity <= 10)).toBe(true);
    }
  });
});

const SOURCES_UNDER_TEST: SourceType[] = [
  'fortigate', 'windows_ad', 'm365', 'aws_cloudtrail', 'crowdstrike', 'generic',
];
