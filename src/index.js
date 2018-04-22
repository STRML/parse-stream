// @flow
const stream = require('stream');

type ParseStreamOptions = {
  parseDataGram: (Buffer) => any,
  getDataGramLength: (Buffer) => number,
  // Insanely, the node default typedef exports this as a global
  // I bet that leads to some nasty bugs
  ...duplexStreamOptions
};

class ParseStream extends stream.Transform {
  constructor(options: ParseStreamOptions) {
    super(options);
    if (typeof options.parseDataGram !== 'function') {
      throw new Error('"parseDataGram: (Buffer) => any" function required!');
    }
    if (typeof options.getDataGramLength !== 'function') {
      throw new Error('"getDataGramLength: (buffer) => number" function required!');
    }
    this._fns = {
      parseDataGram: options.parseDataGram,
      getDataGramLength: options.getDataGramLength,
    };
    this._continuation = {
      chunks: [],
      desiredLen: 0,
      recvLen: 0
    };
  }
  _fns: *;
  _continuation: *;
  _transform(chunk, encoding, callback) {
    // It's possible the data coming through here is split into pieces; we need to buffer
    // until we know we have the whole message.
    const continuation = this._continuation;
    if (continuation.chunks.length > 0) {
      continuation.chunks.push(chunk);
      continuation.recvLen += chunk.length;

      // Not enough data yet?
      // Special case: incomplete first chunk, so desiredLen is Infinity.
      // We will fall through, concat, and the while() below will never run, causing us to form another continuation.
      if (Number.isFinite(continuation.desiredLen) && continuation.recvLen < continuation.desiredLen) {
        return callback();
      }
      // Done coalescing, reset.
      chunk = Buffer.concat(continuation.chunks);
      continuation.chunks = [];
    }

    let thisLen = this._fns.getDataGramLength(chunk);

    // Keep emitting while there's data to emit.
    while (thisLen <= chunk.length) {
      const thisSlice = chunk.slice(0, thisLen);
      // Useful for metrics. TODO better API for this?
      this.emit('chunkLen', thisLen);
      // Design question: Do we even want to parse here or just push the raw buffer,
      // and let the developer pipe into another stream to actually parse it?
      this.push(this._fns.parseDataGram(thisSlice));

      // Queue it up again
      chunk = chunk.slice(thisLen);
      thisLen = this._fns.getDataGramLength(chunk);
    }

    //
    // Looks like there's more to come in the next payload?
    //
    if (chunk.length) {
      this._continuation.chunks.push(chunk);
      this._continuation.desiredLen = thisLen;
      this._continuation.recvLen = chunk.length;
    }

    return callback();
  }
}

module.exports = ParseStream;
