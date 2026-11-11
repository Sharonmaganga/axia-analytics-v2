/**
 * Axia Analytics website forms: Google Apps Script web app.
 *
 * Handles two forms that post to the URL in config.js:
 *   form=contact    "Discuss your business challenge" on the homepage
 *   form=readiness  the free AI readiness check (ai-readiness.html)
 *
 * For each submission it saves a row to the Google Sheet, emails an alert to
 * ALERT_TO, and emails the visitor (an auto-reply, or their readiness report).
 * It answers with JSON {ok:true} or {ok:false,error:"..."} so the website can
 * tell the visitor when something went wrong.
 *
 * How to install: see apps-script/README.md.
 */

// ---- settings -------------------------------------------------------------
// Who gets the "new lead" alerts. Comma separated.
var ALERT_TO = 'hello@axiaanalytics.com,Sharonmaganga@gmail.com';
// Address visitors reply to.
var REPLY_TO = 'hello@axiaanalytics.com';
var FROM_NAME = 'Axia Analytics';
// Leave empty if this script was opened from the sheet (Extensions > Apps Script).
// If it is a standalone script, paste the sheet ID from its URL:
// https://docs.google.com/spreadsheets/d/<THIS PART>/edit
var SHEET_ID = '';

// ---- web app entry points -------------------------------------------------
function doGet() {
  return json_({ ok: true, status: 'running' });
}

function doPost(e) {
  var p = (e && e.parameter) || {};
  try {
    if (p.company_website) return json_({ ok: true }); // honeypot: bots fill this in
    var form = p.form === 'readiness' ? 'readiness' : 'contact';
    var problems = [];
    if (form === 'readiness') handleReadiness_(p, problems);
    else handleContact_(p, problems);
    if (problems.length) {
      console.error('Partial failure (' + form + '): ' + problems.join(' | '));
      return json_({ ok: false, error: problems.join(' | ') });
    }
    return json_({ ok: true });
  } catch (err) {
    console.error('doPost failed: ' + (err && err.stack || err));
    return json_({ ok: false, error: String(err) });
  }
}

// ---- contact form ---------------------------------------------------------
function handleContact_(p, problems) {
  var fields = ['name', 'email', 'org', 'phone', 'budget', 'engage', 'msg'];
  attempt_(problems, 'save to sheet', function () { saveRow_('Contact', fields, p); });

  attempt_(problems, 'alert email', function () {
    MailApp.sendEmail({
      to: ALERT_TO,
      replyTo: p.email || REPLY_TO,
      name: FROM_NAME + ' website',
      subject: 'New enquiry from ' + (p.name || 'the website') + (p.org ? ' (' + p.org + ')' : ''),
      htmlBody: table_([
        ['Name', p.name], ['Email', p.email], ['Organisation', p.org], ['Phone', p.phone],
        ['Budget range', p.budget], ['Preferred engagement', p.engage], ['Message', p.msg]
      ])
    });
  });

  if (validEmail_(p.email)) {
    attempt_(problems, 'auto-reply', function () {
      MailApp.sendEmail({
        to: p.email,
        replyTo: REPLY_TO,
        name: FROM_NAME,
        subject: 'We have your message',
        htmlBody: wrap_(
          '<p>Hi ' + esc_(first_(p.name)) + ',</p>' +
          '<p>Thank you for getting in touch with Axia Analytics. We have your message and will reply within one business day.</p>' +
          '<p>Sharon Maganga<br>Axia Analytics</p>')
      });
    });
  }
}

// ---- AI readiness check ---------------------------------------------------
var QUESTIONS_ = [
  { q: 'How is data currently handled across your teams?', topic: 'Data',
    notes: ['Your data lives mostly in spreadsheets that are emailed around. AI works best on data it can reach in one place, so a first step is to pick the one spreadsheet that matters most and give it a single home.',
            'Your data sits in a few tools that do not talk to each other. Connecting the two that feed your most important report is usually enough to start a useful pilot.',
            'You have a warehouse or BI in place with decent hygiene. You can move straight to using that data in a pilot rather than cleaning it first.'] },
  { q: 'Has leadership identified a specific process AI could improve?', topic: 'Use case',
    notes: ['There is interest in AI but no specific process yet. The fastest progress comes from choosing one task your team repeats every week and measuring how long it takes today.',
            'You have a rough idea of where AI could help. Scoping it means writing down who does the task, how often, and what it costs, so you can judge a pilot against it.',
            'You have a clear process with a measurable cost. That is the strongest starting point for a pilot with a result you can prove.'] },
  { q: 'Who owns AI initiatives internally?', topic: 'Ownership',
    notes: ['Nobody owns AI yet. Naming one person, even part time, is what turns interest into a project that finishes.',
            'Ownership is split across a few interested people. Choosing one lead, with the others supporting, avoids the work stalling between them.',
            'You have a named owner with budget authority, which removes the most common reason pilots stall.'] },
  { q: 'How would your team react to a new AI tool tomorrow?', topic: 'Team readiness',
    notes: ['Your team is wary after past tools that did not stick. Start with something that removes a task they dislike, and train them on their own work rather than a generic demo.',
            'Your team is curious but cautious. Short, role-based sessions that show the tool on real tasks usually win them over.',
            'Your team is eager and already asking. Give them clear guidance on what is safe to use so that enthusiasm does not create risk.'] },
  { q: "What's your realistic budget posture for a pilot?", topic: 'Budget',
    notes: ['There is no budget yet. A small, time-boxed pilot with a clear before-and-after measure is the easiest way to make the case for one.',
            'Budget is modest and depends on return. Pick a pilot where the time saved can be counted in the first month.',
            'Budget is approved. The main decision now is choosing the right first project, which a short scoping step settles.'] }
];

var BANDS_ = {
  'Early stage': {
    summary: "You're not behind. Most organisations are here. The gap right now is direction, not tooling.",
    steps: ['Choose one task your team repeats every week and time it for two weeks.',
            'Name one person to own AI work, even for a few hours a week.',
            'Agree simple rules for which AI tools staff may use and what data must stay out of them.']
  },
  'Building momentum': {
    summary: 'The foundations exist. A focused pilot on one process, with a named owner and a real budget, would move you from interested to operating with AI within a quarter.',
    steps: ['Write a one-page scope for your best candidate process: who, how often, and what it costs today.',
            'Run a four to six week pilot on that process and measure time saved.',
            'Train the people doing the task on the tool, using their own work.']
  },
  'Ready to move': {
    summary: 'You have the data, the ownership and the appetite. The risk now is picking the wrong first project.',
    steps: ['Shortlist two or three processes and rank them by cost today and ease of change.',
            'Pick one, set a target, and give the pilot a fixed end date.',
            'Plan how you will roll a successful pilot out to the rest of the team.']
  }
};

function handleReadiness_(p, problems) {
  var fields = ['name', 'email', 'org', 'role', 'industry', 'size', 'tools', 'timewaster', 'start',
                'score', 'max', 'band', 'answers', 'answer_text', 'consent'];
  attempt_(problems, 'save to sheet', function () { saveRow_('AI Readiness', fields, p); });

  attempt_(problems, 'alert email', function () {
    MailApp.sendEmail({
      to: ALERT_TO,
      replyTo: p.email || REPLY_TO,
      name: FROM_NAME + ' website',
      subject: 'AI readiness: ' + (p.name || 'someone') + (p.org ? ' (' + p.org + ')' : '') +
               ' scored ' + p.score + '/' + p.max + ' ' + (p.band || ''),
      htmlBody: table_([
        ['Score', p.score + '/' + p.max + ' (' + (p.band || '') + ')'],
        ['Name', p.name], ['Email', p.email], ['Organisation', p.org], ['Role', p.role],
        ['Industry', p.industry], ['Team size', p.size], ['Tools', p.tools],
        ['Most time-consuming task', p.timewaster], ['When to start', p.start],
        ['Answers', String(p.answer_text || '').split(' | ').join('<br>')],
        ['Consent to emails', p.consent ? 'Yes' : 'No']
      ], true) + '<p>The visitor has been emailed their report.</p>'
    });
  });

  if (!validEmail_(p.email)) { problems.push('visitor email address is missing or invalid'); return; }
  attempt_(problems, 'report email', function () {
    MailApp.sendEmail({
      to: p.email,
      replyTo: REPLY_TO,
      name: FROM_NAME,
      subject: 'Your AI readiness report: ' + p.score + '/' + p.max + ' ' + (p.band || ''),
      htmlBody: reportHtml_(p)
    });
  });
}

function reportHtml_(p) {
  var band = BANDS_[p.band] || BANDS_['Early stage'];
  var picks = String(p.answers || '').split(',');
  var rows = QUESTIONS_.map(function (q, i) {
    var v = parseInt(picks[i], 10);
    var note = q.notes[v - 1];
    if (!note) return '';
    return '<tr><td style="padding:10px 12px;border-top:1px solid #E3E6DD;vertical-align:top;width:130px;font-weight:600;color:#0B2F28;">' +
      esc_(q.topic) + '<br><span style="font-weight:400;color:#336D64;">' + v + ' of 3</span></td>' +
      '<td style="padding:10px 12px;border-top:1px solid #E3E6DD;">' + esc_(note) + '</td></tr>';
  }).join('');
  var steps = band.steps.map(function (s) { return '<li style="margin-bottom:6px;">' + esc_(s) + '</li>'; }).join('');
  var task = p.timewaster
    ? '<p>You told us the task that takes your team the most time is <em>' + esc_(p.timewaster) +
      '</em>. That is often a good first candidate, and we are happy to look at it with you.</p>'
    : '';
  return wrap_(
    '<p>Hi ' + esc_(first_(p.name)) + ',</p>' +
    '<p>Thank you for taking the Axia Analytics AI readiness check' + (p.org ? ' for ' + esc_(p.org) : '') + '. Here is your report.</p>' +
    '<div style="background:#0B2F28;color:#F5F6F1;border-radius:12px;padding:18px 20px;margin:18px 0;">' +
      '<div style="font-size:30px;font-weight:800;">' + esc_(p.score) + '/' + esc_(p.max) + '</div>' +
      '<div style="font-size:16px;font-weight:700;color:#B8F35A;margin:2px 0 8px;">' + esc_(p.band) + '</div>' +
      '<div style="font-size:14px;line-height:1.5;">' + esc_(band.summary) + '</div></div>' +
    '<h3 style="color:#0B2F28;margin:22px 0 6px;">What your answers tell us</h3>' +
    '<table style="border-collapse:collapse;width:100%;font-size:14px;line-height:1.5;">' + rows + '</table>' +
    '<h3 style="color:#0B2F28;margin:22px 0 6px;">First steps we suggest</h3><ol style="padding-left:20px;font-size:14px;line-height:1.5;">' + steps + '</ol>' +
    task +
    '<p>If you would like to talk it through, reply to this email or book a call at ' +
    '<a href="https://axiaanalytics.com/#contact" style="color:#336D64;">axiaanalytics.com</a>.</p>' +
    '<p>Sharon Maganga<br>Axia Analytics</p>');
}

// ---- helpers --------------------------------------------------------------
function attempt_(problems, label, fn) {
  try { fn(); } catch (err) { problems.push(label + ': ' + err); }
}

function saveRow_(tabName, fields, p) {
  var ss = SHEET_ID ? SpreadsheetApp.openById(SHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('No sheet found. Set SHEET_ID at the top of the script.');
  var sh = ss.getSheetByName(tabName) || ss.insertSheet(tabName);
  if (sh.getLastRow() === 0) sh.appendRow(['Received'].concat(fields));
  sh.appendRow([new Date()].concat(fields.map(function (f) { return p[f] || ''; })));
}

function table_(rows, rawLast) {
  return '<table style="border-collapse:collapse;font:14px/1.5 Arial,sans-serif;">' + rows.map(function (r) {
    var val = (rawLast && r[0] === 'Answers') ? r[1] : esc_(r[1] || '').replace(/\n/g, '<br>');
    return '<tr><td style="padding:6px 12px 6px 0;font-weight:bold;vertical-align:top;">' + esc_(r[0]) +
           '</td><td style="padding:6px 0;">' + val + '</td></tr>';
  }).join('') + '</table>';
}

function wrap_(inner) {
  return '<div style="font:15px/1.6 Arial,sans-serif;color:#101816;max-width:600px;">' + inner + '</div>';
}

function esc_(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function first_(name) { return String(name || 'there').trim().split(/\s+/)[0]; }

function validEmail_(e) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(e || '').trim()); }

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// Run this once from the editor (select testReadiness, press Run) to check
// that emails arrive. It sends a sample report and alert to your Gmail.
function testReadiness() {
  var to = ALERT_TO.split(',')[1] || ALERT_TO.split(',')[0];
  var out = doPost({ parameter: {
    form: 'readiness', name: 'Test Person', email: to.trim(), org: 'Test Org', role: 'CEO',
    industry: 'Other', size: '1 to 10', tools: 'WhatsApp', timewaster: 'Monthly reports',
    start: 'Just exploring', score: '9', max: '15', band: 'Building momentum',
    answers: '2,2,1,2,2', answer_text: 'test', consent: 'yes'
  } });
  console.log(out.getContent());
}
