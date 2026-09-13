// แปลง log AWS CloudTrail

import type { CanonicalEvent, Outcome, Parser } from '../schema.js';
import { blankEvent, unparsed } from '../schema.js';
import {
  coerceDate,
  coerceInt,
  coerceIp,
  coerceString,
  isPlainObject,
  looksLikeEnvelope,
  parseEnvelope,
  pick,
  tryJson,
} from '../util.js';

const AUTH_EVENTS = new Set([
  'consolelogin',
  'assumerole',
  'assumerolewithsaml',
  'assumerolewithwebidentity',
  'getsessiontoken',
  'checkmfa',
]);

function actionFor(eventName: string, isAuth: boolean): string {
  if (isAuth) return 'login';
  const n = eventName.toLowerCase();
  if (n.startsWith('create') || n.startsWith('put') || n.startsWith('add')) return 'create';
  if (n.startsWith('delete') || n.startsWith('remove')) return 'delete';
  return eventName;
}

function outcomeOf(o: Record<string, unknown>): Outcome {
  const console_ = coerceString(pick(o, 'responseElements', 'ConsoleLogin'))?.toLowerCase();
  if (console_ === 'success') return 'success';
  if (console_ === 'failure') return 'failure';

  if (coerceString(o.errorCode) || coerceString(o.errorMessage)) return 'failure';
  if (o.eventName) return 'success';
  return 'unknown';
}

function principalOf(o: Record<string, unknown>): string | null {
  return (
    coerceString(pick(o, 'userIdentity', 'userName')) ??
    coerceString(pick(o, 'userIdentity', 'sessionContext', 'sessionIssuer', 'userName')) ??
    coerceString(pick(o, 'userIdentity', 'principalId'))?.split(':').pop() ??
    coerceString(pick(o, 'userIdentity', 'arn'))?.split('/').pop() ??
    coerceString(pick(o, 'userIdentity', 'type')) ??
    null
  );
}

export const parseAwsCloudtrail: Parser = (input): CanonicalEvent => {
  const json = input.json ?? tryJson(input.raw);
  if (!isPlainObject(json)) {
    return unparsed('aws_cloudtrail', input, 'payload is not a JSON object');
  }

  if (looksLikeEnvelope(json)) {
    const base = parseEnvelope('aws_cloudtrail', input, json);
    base.source = 'aws';
    base.vendor = 'AWS';
    base.product = 'CloudTrail';
    base.eventCategory ??= 'audit';
    return base;
  }

  const eventName = coerceString(json.eventName);
  if (!eventName) {
    return unparsed('aws_cloudtrail', input, 'no eventName field');
  }

  const event = blankEvent('aws_cloudtrail', input);
  const outcome = outcomeOf(json);
  const isAuth = AUTH_EVENTS.has(eventName.toLowerCase());

  event.ts = coerceDate(json.eventTime) ?? input.receivedAt;
  event.source = 'aws';
  event.vendor = 'AWS';
  event.product = 'CloudTrail';
  event.eventType = eventName;
  event.eventSubtype = coerceString(json.eventSource);
  event.action = actionFor(eventName, isAuth);
  event.eventAction = event.action;
  event.eventOutcome = outcome;
  event.eventCategory = isAuth ? 'authentication' : 'audit';
  event.severity = outcome === 'failure' ? 6 : 2;

  event.userName = principalOf(json);
  event.host = coerceString(json.awsRegion);
  event.url = coerceString(json.requestParameters && pick(json, 'requestParameters', 'url'));
  event.statusCode = coerceInt(json.responseStatusCode);

  event.cloudAccountId = coerceString(pick(json, 'userIdentity', 'accountId') ?? json.recipientAccountId);
  event.cloudRegion = coerceString(json.awsRegion);
  event.cloudService = coerceString(json.eventSource)?.replace(/\.amazonaws\.com$/, '') ?? null;

  event.srcIp = coerceIp(json.sourceIPAddress);

  const mfa = coerceString(pick(json, 'additionalEventData', 'MFAUsed'));
  const errorCode = coerceString(json.errorCode);
  const errorMessage = coerceString(json.errorMessage);

  event.attrs = {
    event_name: eventName,
    event_source: coerceString(json.eventSource),
    identity_type: coerceString(pick(json, 'userIdentity', 'type')),
    user_agent: coerceString(json.userAgent),
  };
  if (mfa) event.attrs.mfa_used = mfa;
  if (errorCode) event.attrs.error_code = errorCode;
  if (errorMessage) event.attrs.reason = errorMessage;
  if (!event.srcIp && coerceString(json.sourceIPAddress)) {
    event.attrs.source = coerceString(json.sourceIPAddress);
  }

  event.message =
    `${eventName}${event.userName ? ` by ${event.userName}` : ''} — ${outcome}` +
    (errorMessage ? ` (${errorMessage})` : '');

  return event;
};
