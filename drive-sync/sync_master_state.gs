// ============================================================
// sync_master_state.gs
// Polls Google Drive for a pending-update staging file created
// by Claude and writes its content into Kunal_Master_State.md.
//
// SETUP (one-time):
//   1. Open the existing Apps Script project:
//      https://script.google.com/macros/s/AKfycbwJOXRooZWrwwW2axJ748Jbv8-o5Kw5TosJGQNCflIu2Rj7k-1hp9eAvvSDG6Avgja8NQ/exec
//   2. In the script editor, add a new file named sync_master_state.gs
//      and paste this entire file's content into it. Save.
//   3. Click the clock icon (Triggers) → + Add Trigger:
//        Function:      processPendingUpdate
//        Event source:  Time-driven
//        Type:          Minutes timer
//        Interval:      Every 5 minutes
//   4. Click Save and authorize when prompted.
//      Required scopes: Google Drive, external URL fetch.
//   5. To verify: run processPendingUpdate() manually once with no
//      staging file present — it should log "done. 0/0 updates applied."
// ============================================================

var MASTER_FILE_ID = '1ghsKLkBmRAakZVoP31vTlo3_CujeS9zA';
var STAGING_NAME   = '_PENDING_Kunal_Master_State.md';
var FOLDER_ID      = '0ALmCp_WftobVUk9PVA';

function processPendingUpdate() {
  var folder = DriveApp.getFolderById(FOLDER_ID);
  var iter   = folder.getFilesByName(STAGING_NAME);

  var pending = [];
  while (iter.hasNext()) {
    pending.push(iter.next());
  }

  if (pending.length === 0) {
    Logger.log('processPendingUpdate: no staging file found — nothing to do.');
    return;
  }

  // Process oldest first so the most recent content wins on the final write
  pending.sort(function(a, b) {
    return a.getDateCreated() - b.getDateCreated();
  });

  var processed = 0;

  for (var i = 0; i < pending.length; i++) {
    var stagingFile = pending[i];
    var newContent  = stagingFile.getBlob().getDataAsString('UTF-8');

    var url = 'https://www.googleapis.com/upload/drive/v3/files/'
              + MASTER_FILE_ID + '?uploadType=media';

    var response = UrlFetchApp.fetch(url, {
      method:             'PATCH',
      contentType:        'text/plain; charset=UTF-8',
      payload:            newContent,
      headers:            { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true
    });

    var code = response.getResponseCode();
    if (code === 200) {
      stagingFile.setTrashed(true);
      processed++;
      Logger.log(
        'processPendingUpdate: success [' + (i + 1) + '/' + pending.length + '] — '
        + stagingFile.getDateCreated()
      );
    } else {
      Logger.log(
        'processPendingUpdate: PATCH failed with HTTP ' + code
        + ' — ' + response.getContentText()
        + ' (staging file left in place for next cycle)'
      );
    }
  }

  Logger.log(
    'processPendingUpdate: done. ' + processed + '/' + pending.length + ' updates applied.'
  );
}
