var fs = require('node-fs-extra');
var path = require('path');
var childProcess = require('child_process');
var spawn = childProcess.spawn;
var psTree = require('ps-tree');
var io = require('socket.io-client');
var path = require('path');

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

var socket = io(config.host);

const pwd = './src/';

var state = Object.assign({
  id: config.machineId,
  runStatus: 'idle',
  syncStatus: 'idle',
}, config);

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

    toFetch = data;

    socket.emit('fetch', toFetch);
  }

  socket.on('file', (data) => {
    var name = data.name;
    var buf = data.buf;
    var mode = data.mode;

    console.log('incoming file', name);
    var filepath = path.join(pwd, name);
    fs.mkdirs(path.dirname(filepath), () => {
      fs.writeFile(filepath, buf, (err) => {
        if (err) {
          status(false);
        } else {
          fs.chmod(filepath, mode, () => {
            console.log('file saved', name);
            status(true);
          });
        }
      });
    });

    function status(success) {
      var i = toFetch.findIndex(f => f.name == name);
      toFetch.splice(i, 1);
      statuses.push(success);

      if (toFetch.length === 0) {
        fetching = false;
        var syncSuccess = statuses.reduce((s, x) => s & x, true);
        setState({ syncStatus: syncSuccess ? 'success' : 'error' });
        socket.emit('fetch-complete', syncSuccess);
      }
    }
  });

  return {
    fetch: fetch,
  };
})();

var processes = [];
var running = false;

// Add a connect listener
socket.on('connect', function () {
  console.log('Connected!');

  socket.emit('worker-connected', state);
});

socket.on('run', function (data) {
  var cmd = data.cmd;

  if (running) {
    console.log('already running');
    return;
  }

  console.log('spawning process');

  var args = cmd.split(' ');
  var arg0 = args.shift();
  var process = spawn(arg0, args, { cwd: path.join(__dirname, pwd) });
  processes.push(process);
  running = true;
  setState({ runStatus: 'running' });

  process.stdout.on('data', (data) => {
    socket.emit('stdout', '' + data);
  });
  process.stderr.on('data', (data) => {
    socket.emit('stderr', '' + data);
    console.log(`stderr: ${data}`);
  });
  process.on('close', (code) => {
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
      childProcess.spawn('kill', ['-2'].concat(children.map(function (p) { return p.PID; })));
    });
  });
  processes.splice(0);
});

socket.on('sync', (data) => {
  // data contains status on the files to sync
  console.log('sync', data);

  // TODO: check what files we need to fetch
  fetcher.fetch(data);
});

socket.on('disconnect', function () {
  console.log('disconnected');
  processes.forEach((process) => {
    process.kill();
  });
});
