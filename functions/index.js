'use strict';
const functions = require('firebase-functions');
const admin = require('firebase-admin');
const globStream = require('glob-stream');
const { Transform, Readable } = require('stream');
const { createReadStream } = require('fs');
const mergeStream = require('merge-stream');
const express = require('express');
const app = express();
const cors = require('cors');
const { join } = require('path');
const webshot = require('webshot');

admin.initializeApp(functions.config().firebase);

const corsOptions = {
  optionsSuccessStatus: 200 // some legacy browsers (IE11, various SmartTVs) choke on 204
}

app.use(cors(corsOptions))

// Express middleware that validates Firebase ID Tokens passed in the Authorization HTTP header.
// The Firebase ID token needs to be passed as a Bearer token in the Authorization HTTP header like this:
// `Authorization: Bearer <Firebase ID Token>`.
// when decoded successfully, the ID Token content will be added as `req.user`.
const authenticate = (req, res, next) => {
  if (!req.headers.authorization || !req.headers.authorization.startsWith('Bearer ')) {
    res.status(403).send('Unauthorized');
    return;
  }
  const idToken = req.headers.authorization.split('Bearer ')[1];
  admin.auth().verifyIdToken(idToken).then(decodedIdToken => {
    req.user = decodedIdToken;
    next();
  }).catch(error => {
    res.status(403).send('Unauthorized');
  });
};

class TransformStream extends Transform {
  constructor() {
    super({objectMode: true});
    this.streams = []
    this.on('finish', () => {
      this.emit('finished', mergeStream(this.streams.concat()))
    });
  }

  _transform(chunk, encoding, callback) {
    this.streams.push(createReadStream(chunk.path));
    callback(null, null);
  }
}

class StreamString extends Readable {
  constructor(string) {
    super();
    this.push(string);
    this.push(null);
  }

  _read() {

  }
}

const rawURL = url => {
  return url.replace('github.com', 'raw.githubusercontent.com');
}

class UpdateSetStream extends Transform {
  constructor() {
    super({objectMode: true});
  }

  _transform(chunk, encoding, callback) {
    callback(null, chunk);
  }
}

app.get('/elementPreview', authenticate, (request, response) => {
  if (request.method !== 'GET') {
    return response.status(403).send('Forbidden!');
  }
  const repo = request.query.repo;
  const name = `${request.query.name}.html`;
  const branch = request.query.branch || 'master';
  const url = join(rawURL(repo), branch, name);
  console.log(url);
  response.writeHead(200, { 'Content-Type': 'application/json' })
  if (url) {
    const download = require('download');
    download(url).pipe(new UpdateSetStream()).pipe(response);
  }
  // fetch
});

app.get('/sets',  (request, response) => {
  switch (request.method) {
    case 'GET':
      // read component sets and stream...
      const sources = globStream('sets/**.json');
      sources.pipe(new TransformStream()).on('finished', streams => {
        response.writeHead(200, { 'Content-Type': 'application/json' })
        streams.pipe(response);
      });
      break;
    default:
      response.status(403).send('Forbidden!');
  }
});

app.get('/user/sets', authenticate, (request, response) => {
  switch (request.method) {
    case 'GET':
      const ref = admin.database().ref(`/users/${request.user.uid}/sets`);
      ref.once('value').then(snapshot => {
        const sets = snapshot.val();
        const streams = [];
        for (const set of sets) {
          for (const item of set) {
            // TODO: document the fact if item.renders = false, no thumbnail gets generated
            if (item.children && item.repo) {
              for (const child of item.children) {
                console.log(item.repo + '/' + child);
              }
            } else if (item.thumbnail !== false && item.repo) {
              // take screenshot ...
            }
          }
          streams.push(new StreamString(JSON.stringify(set)));
        }
        response.writeHead(200, { 'Content-Type': 'application/json' });
        mergeStream(streams.concat()).pipe(response);
      });
      break;
    default:
      response.status(403).send('Forbidden!');
  }
});

exports.api = functions.https.onRequest(app);
