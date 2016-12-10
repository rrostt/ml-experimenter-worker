var fs = require('fs');
var path = require('path');

module.exports = function lsSync(cwd, ignore = []) {
  return walkSync(cwd, []);

  function walkSync(dir, filelist) {
    var files = fs.readdirSync(dir);
    files.forEach(function (file) {
      if (ignore.indexOf(file) !== -1) {
        return;
      }

      var filepath = path.join(dir, file);
      var stats = fs.statSync(filepath);
      if (stats.isDirectory()) {
        filelist = walkSync(filepath, filelist);
      } else {
        filelist.push({
          name: filepath.replace(cwd, ''),
          size: stats.size,
          mtime: stats.mtime.getTime(),
        });
      }
    });

    return filelist;
  }
};
