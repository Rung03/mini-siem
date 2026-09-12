import type { CanonicalEvent, Outcome, Parser } from '../schema.js';
import { blankEvent, unparsed } from '../schema.js';
import {
  coerceDate,
  coerceIp,
  coerceString,
  isPlainObject,
  looksLikeEnvelope,
  parseEnvelope,
  tryJson,
} from '../util.js';

const LOGIN_OPERATIONS = new Set([
  'userloggedin',
  'userloginfailed',
  'usersignedin',
  'signinevent',
]);

const LOGON_ERRORS: Record<string, string> = {
  invalidusernameorpassword: 'invalid user name or password',
  usernotfound: 'user not found',
  useraccountnotfound: 'user account not found',
  usrpwdexpired: 'password expired',
  useraccountdisabled: 'account disabled',
  useraccountlocked: 'account locked',
  usermustchangepassword: 'password change required',
  strongauthenticationrequired: 'MFA required',
  blockedbyconditionalaccess: 'blocked by conditional access',
};

function outcomeOf(o: Record<string, unknown>): Outcome {
  const status = coerceString(o.ResultStatus)?.toLowerCase();
  if (status === 'success' || status === 'succeeded') return 'success';
  if (status === 'failed' || status === 'failure') return 'failure';

  const op = coerceString(o.Operation)?.toLowerCase() ?? '';
  if (op.includes('failed')) return 'failure';
  if (op.includes('loggedin') || op.includes('signedin')) return 'success';
  return 'unknown';
}

export const parseM365: Parser = (input): CanonicalEvent => {
  const json = input.json ?? tryJson(input.raw);
  if (!isPlainObject(json)) {
    return unparsed('m365', input, 'payload is not a JSON object');
  }

  if (looksLikeEnvelope(json)) {
    const base = parseEnvelope('m365', input, json);
    base.source = 'm365';
    base.vendor = 'Microsoft';
    base.product = 'Microsoft 365';
    if (json.workload) base.attrs.workload = coerceString(json.workload);
    return base;
  }

  const operation = coerceString(json.Operation);
  if (!operation && !json.RecordType) {
    return unparsed('m365', input, 'no Operation or RecordType field');
  }

  const event = blankEvent('m365', input);
  const outcome = outcomeOf(json);
  const op = operation?.toLowerCase() ?? '';
  const isLogin = LOGIN_OPERATIONS.has(op) || op.includes('login') || op.includes('signin');

  event.ts = coerceDate(json.CreationTime ?? json.CreationDate) ?? input.receivedAt;
  event.source = 'm365';
  event.vendor = 'Microsoft';
  event.product = 'Microsoft 365';
  event.eventType = operation;
  event.eventSubtype = coerceString(json.Workload);
  event.action = isLogin ? 'login' : operation ? operation.toLowerCase() : null;
  event.eventAction = isLogin ? 'login' : (operation ?? 'unknown');
  event.eventOutcome = outcome;
  event.eventCategory = isLogin ? 'authentication' : 'audit';
  event.severity = outcome === 'failure' ? 6 : 2;

  event.userName = coerceString(json.UserId ?? json.UserPrincipalName);
  event.srcIp = coerceIp(json.ClientIP ?? json.ActorIpAddress ?? json.ClientIPAddress);
  event.host = coerceString(json.OrganizationName) ?? coerceString(json.Workload);
  event.cloudService = coerceString(json.Workload);
  event.cloudAccountId = coerceString(json.OrganizationId);

  event.attrs = {
    operation,
    workload: coerceString(json.Workload),
    record_type: json.RecordType,
    result_status: coerceString(json.ResultStatus),
  };

  const logonError = coerceString(json.LogonError);
  if (logonError) {
    event.attrs.logon_error = logonError;
    const friendly = LOGON_ERRORS[logonError.toLowerCase()];
    if (friendly) event.attrs.reason = friendly;
  }
  if (json.UserAgent) event.attrs.user_agent = coerceString(json.UserAgent);
  if (json.ObjectId) event.attrs.object_id = coerceString(json.ObjectId);

  const extended = json.ExtendedProperties;
  if (Array.isArray(extended)) {
    for (const entry of extended) {
      if (isPlainObject(entry)) {
        const name = coerceString(entry.Name);
        if (name === 'RequestType' || name === 'ResultStatusDetail') {
          event.attrs[name.toLowerCase()] = coerceString(entry.Value);
        }
      }
    }
  }

  event.message =
    `${operation ?? 'M365 audit event'}${event.userName ? ` for ${event.userName}` : ''}` +
    (outcome === 'failure' && logonError ? ` (${logonError})` : '');

  return event;
};
