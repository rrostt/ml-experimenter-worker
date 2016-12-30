var fs = require('node-fs-extra');
var path = require('path');
var spawn = require('child_process').spawn;
var psTree = require('ps-tree');
var io = require('socket.io-client');
var socketio = require('socket.io');
var lsSync = require('./lsSync');
var parseArgs = require('parse-spawn-args').parse;

var configPath = process.argv.length >= 3 ? process.argv[2] : './config.json';
if (!configPath.startsWith('/') && !configPath.startsWith('.')) {
  configPath = path.join(process.env.PWD, configPath);
}

var config;

try {
  config = require(configPath);
} catch (e) {
  console.log(e);
  config = {
    host: 'http://localhost:1234',
    machineId: 'nc-' + new Date().getTime(),
  };
}

config.id = config.machineId || new Date().getTime();

const pwd = path.join(__dirname, './src/');

var state = Object.assign({
  id: config.machineId,
  runStatus: 'idle',
  syncStatus: 'idle',
}, config);

if (config.host) {
  var socket = io.connect(config.host, { rejectUnauthorized: false });

  // Add a connect listener
  socket.on('connect', function () {
    console.log('Connected!');

    console.log(socket.io.engine.transport.name);

    socket.emit('worker-connected', state);
  });

  initSocket(socket);
} else if (config.port) {
  var httpServer = require('http').createServer().listen(+config.port, () => {
    var server = socketio.listen(httpServer);
    server.on('connection', socket => {
      initSocket(socket);

      socket.emit('worker-connected', state);
    });

    console.log('listening on port ' + config.port);
  });
} else {
  console.log('ERROR: either host or port must be set. Exiting');
}

function initSocket(socket) {
  console.log('initialising socket');

  function setState(perm) {
    Object.assign(state, perm);

    socket.emit('state-change', state);
  }

  var fetcher = (function () {
    var toFetch = [];
    var statuses = [];
    var fetching = false;

    function fetch(data) {
      if (fetching) {
        console.log('fetching in progress');
        return false;
      }

      fetching = true;
      setState({ syncStatus: 'syncing' });

      var existing = lsSync(pwd);

      toFetch = data.filter(candidate => {
        var existingFile = existing.find(e => e.name === candidate.name);
        return !existingFile || existingFile.mtime !== candidate.mtime;
      });

      console.log('files to fetch', toFetch);

      if (toFetch.length > 0) {
        socket.emit('fetch', toFetch);
      } else {
        fetchingComplete(true);
      }
    }

    socket.on('file', (data) => {
      var name = data.name;
      var buf = data.buf;
      var mode = data.mode;
      var mtime = data.mtime;

      console.log('incoming file', name);
      var filepath = path.join(pwd, name);
      fs.mkdirs(path.dirname(filepath), () => {
        fs.writeFile(filepath, buf, (err) => {
          if (err) {
            status(false);
          } else {
            fs.chmod(filepath, mode, () => {
              fs.utimes(filepath, Date.now() / 1000, mtime / 1000, (err) => {
                if (err) {
                  console.log('error setting mtime...', err);
                }

                console.log('file saved', name);
                status(true);
              });
            });
          }
        });
      });

      function status(success) {
        var i = toFetch.findIndex(f => f.name == name);
        toFetch.splice(i, 1);
        statuses.push(success);

        if (toFetch.length === 0) {
          var syncSuccess = statuses.reduce((s, x) => s & x, true);
          fetchingComplete(syncSuccess);
        }
      }
    });

    function fetchingComplete(success) {
      fetching = false;
      setState({ syncStatus: success ? 'success' : 'error' });
      socket.emit('fetch-complete', success);
    }

    return {
      fetch: fetch,
    };
  })();

  var processes = [];
  var running = false;

  socket.on('run', function (data) {
    var cmd = data.cmd;

    if (running) {
      console.log('already running');
      return;
    }

    console.log('spawning process');

    var args = parseArgs(cmd); //cmd.split(' ');
    var arg0 = args.shift();

    try {
      var process = spawn(arg0, args, { cwd: pwd });
    } catch (e) {
      console.log('spawn exception', e);
      socket.emit('stderr', JSON.stringify(e, null, '  '));
      return;
    }

    processes.push(process);
    running = true;
    setState({ runStatus: 'running' });

    process.on('error', err => {
      console.log('process error', err);
      socket.emit('stderr', JSON.stringify(err, null, '  '));
    });
    process.stdout.on('data', (data) => {
      socket.emit('stdout', '' + data);
    });
    process.stderr.on('data', (data) => {
      socket.emit('stderr', '' + data);
      console.log(`stderr: ${data}`);
    });
    process.on('close', (code) => {
      console.log('process closed');
      socket.emit('data', '<< CLOSED >>');
      processes.splice(processes.indexOf(process), 1);
      running = false;
      setState({ runStatus: 'idle' });
    });
  });

  socket.on('stop', function () {
    console.log('stopping');
    processes.forEach((process) => {
      console.log('stopping process');
      psTree(process.pid, function (err, children) {
        spawn('kill', ['-2'].concat(children.map(function (p) { return p.PID; })));
      });
    });
    processes.splice(0);
  });

  socket.on('sync', (data) => {
    // data contains status on the files to sync
    console.log('sync');

    fetcher.fetch(data);
  });

  socket.on('disconnect', function () {
    console.log('disconnected');
    processes.forEach((process) => {
      process.kill();
    });
  });
}
