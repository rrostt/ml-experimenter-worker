# ML-experimenter worker client

NodeJS application that connects to an ml-experienter server and allow
syncing files, and running code residing in those files.

The client makes a websocket connection to the server at the host given by
the config file. Once established it listens for commands.

## State Object

Each client maintains a state object during its lifetime. It is initialised with
the content of the config file. Placing any property in the config file,
allow you to associate data with clients. Anytime the client changes, a
`state-change` event is emitted with the new state object.

The state object contains (beyond what is given by the config.json)
```
{
  id: config.machineId || new Date().getTime(),
  runStatus: 'idle',  // idle | running
  syncStatus: 'idle', // idle | syncing | success | error
}
```


## Usage

Create a config.json file with `host` and `accessToken` set according to the
server. The accessToken will specify the user and use session to place this
client. Host is the server address.

When launching a client through the mle-frontend this file is generated.


## Commands

Commands are emitted on which the client is connected.

### run

Options: { cmd: command }

This command spawns a new process on the host machine running the command
given by cmd. Anything outputted on stdout is sent back on the socket as `stdout`
events, and stderr on `stderr`. Errors occuring while spawning and during
process execution is also sent as `stderr` events.

### stop

Stops any running processes by virtually sending Ctrl-C to the process.

### sync

Options: [ file, ... ]

Tells the client to request new files from the client. The array contains
information about the files that are to be synced, and is to be compared with
the local files. Any changed files are requested using `fetch`, on which the
connected server should respond with individual files using the `file` event
below.

When all requested files have been received, a `fetch-complete` event is emitted
with a boolean saying if it was successful or not. The state object will also
reflect this in its syncStatus property.


### file

Options:
```
{
  name: filename,
  buf: file-buffer,
  mode: accessMode,
}
```

Incoming file. File with filename and content in buffer.
