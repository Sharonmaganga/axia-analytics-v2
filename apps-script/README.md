# Website forms script (Google Apps Script)

`Code.gs` is the code behind the form URL in `config.js`. It is not run by
GitHub Pages: it runs in Google's Apps Script, under the Google account that owns
the form sheet. Changing this file does nothing until it is pasted into Apps
Script and deployed as below.

It handles the homepage contact form and the AI readiness check: saves each
submission to a tab of the Google Sheet ("Contact" or "AI Readiness"), emails an
alert to `ALERT_TO`, and emails the visitor (auto-reply or readiness report).

## Install or update

1. Open the Google Sheet the website forms write to, then **Extensions > Apps Script**.
   (Or open the project at script.google.com if it is a standalone script.)
2. Note any sheet ID in the old code (`openById('...')`). Select all the code in
   `Code.gs` and replace it with this file. If you noted an ID, paste it into `SHEET_ID`.
3. Save. In the function menu at the top choose **testReadiness**, press **Run**,
   and allow the permissions it asks for. A sample report and alert should reach
   Gmail within a minute.
4. **Deploy > Manage deployments**, click the pencil on the existing web app,
   set **Version** to **New version**, keep *Execute as: Me* and
   *Who has access: Anyone*, then **Deploy**. The URL stays the same, so
   `config.js` does not change. (Do not use *New deployment*: that makes a new URL.)

## When an email is missing

- **Executions** (left sidebar in Apps Script) lists every submission and any error.
- The sheet shows whether the submission arrived at all.
- Gmail allows about 100 recipients a day from Apps Script on a personal account.
