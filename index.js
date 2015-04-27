'use strict';

var mongoose = require('mongoose');
var Schema = mongoose.Schema;
var _ = require('lodash');
var async = require('async');

var uniqueSchema = new Schema({
  _id: { type: {
    _id: false,
    collection: String,
    vals: Schema.Types.Mixed
  }, unique: true },
  refId: Schema.Types.Mixed
}, {
  versionKey: false,
  autoIndex: false,
  shardKey: {
    _id: 'hashed'
  }
});
var UniqueModel = mongoose.model('mongooseUniqueShard', uniqueSchema);

function performActionForAll(prefix, paths, doc, action, next) {
  if (_.isObject(paths)) {
    return async.each(Object.keys(paths), function(key, cb) {
      performActionForAll((prefix ? prefix + '.' : '') + key, paths[key], doc, action, cb);
    }, next);
  }
  // we have a path leaf so let's check if this path is unique
  var val = doc.get(prefix);
  var existingVal;
  if (doc._uniqueShard && doc._uniqueShard.initVals) {
    existingVal = doc._uniqueShard.initVals[prefix];
  }
  if (_.isUndefined(val) && _.isUndefined(existingVal)) {
    return next();
  }
  action(prefix, val, existingVal, next);
}

function checkUnique(prefix, paths, doc, next) {
  function performCheckUnique(path, val, existingVal, cb) {
    var query = { '_id.collection': doc.constructor.collection.name };
    query['_id.vals.' + path] = val;
    UniqueModel.findOne(query, function(err, uniqueDoc) {
      if (err) {
        return cb(err);
      }
      if (!uniqueDoc) {
        return cb();
      }
      doc.constructor.collection.findOne({ _id: uniqueDoc.refId }, function(err, originalDoc) {
        if (err) {
          return cb(err);
        }
        if (!originalDoc) {
          return uniqueDoc.remove(cb);
        }
        return cb(new Error('value ' + val + ' for path ' + path + ' is not unique'));
      });
    });
  }
  performActionForAll(prefix, paths, doc, performCheckUnique, next);
}

function saveUnique(prefix, paths, doc, next) {
  function doSaveUnique(path, val, existingVal, cb) {
    var entry = new UniqueModel();
    entry._id = {};
    entry._id.collection = doc.constructor.collection.name;
    entry.set('_id.vals.' + path, val);
    entry.refId = doc._id;
    entry.save(cb);
  }
  performActionForAll(prefix, paths, doc, doSaveUnique, next);
}

function removeExistingUnique(prefix, paths, doc, next) {
  function doRemoveUnique(path, val, existingVal, cb) {
    var query = { '_id.collection': doc.constructor.collection.name };
    query['_id.vals.' + path] = existingVal;
    UniqueModel.remove(query, next);
  }
  performActionForAll(prefix, paths, doc, doRemoveUnique, next);
}

function storeCurrentVals(prefix, paths, doc, next) {
  function storeValue(path, val, existingVal, cb) {
    if (!doc._uniqueShard) {
      Object.defineProperty(doc, '_uniqueShard', { enumerable: false, value: {} });
      doc._uniqueShard.initVals = {};
    }
    doc._uniqueShard.initVals[path] = val;
    return cb();
  }
  performActionForAll(prefix, paths, doc, storeValue, next);
}

module.exports = function(schema) {
  var forgetCb = function() {};
  schema._uniqueShard = {};
  schema._uniqueShard.paths = getPaths(schema);
  schema.pre('init', function(next) {
    var doc = this;
    doc.on('init', function() {
      storeCurrentVals('', doc.schema._uniqueShard.paths, doc, forgetCb);
    });
    next();
  });
  schema.pre('validate', function(next) {
    var doc = this;
    checkUnique('', doc.schema._uniqueShard.paths, doc, next);
  });
  schema.pre('save', function(next) {
    var doc = this;
    removeExistingUnique('', doc.schema._uniqueShard.paths, doc, function(err) {
      if (err) {
        return next(err);
      }
      saveUnique('', doc.schema._uniqueShard.paths, doc, next);
    });
  });
  schema.post('save', function() {
    var doc = this;
    storeCurrentVals('', doc.schema._uniqueShard.paths, doc, forgetCb);
  });
  schema.post('remove', function() {
    var doc = this;
    removeExistingUnique('', doc.schema._uniqueShard.paths, doc, forgetCb);
  });
};

function getPaths(schema) {
  return _.reduce(schema.tree, function(memo, node, path) {
    var p = isUnique(node, path);
    p && (memo[path] = p);
    return memo;
  }, {});
}

function isUnique(node, path) {
  if (!node) {
    return false;
  }
  // Array case
  if (node instanceof Array) {
    var f = _.first(node);
    // Nested Schema case
    if (f && f.tree) {
      return getPaths(f, {});
    } else {
      return isUnique(f, path);
    }
  } else if (_.isObject(node) && !node.type && !node.getters) { // object case
    var s = { tree: node };
    var o = getPaths(s, {});

    return _.isEmpty(o) ? false : o;
  } else {
    return node.uniqueShard;
  }
}