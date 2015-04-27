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
  if (_.isUndefined(val)) {
    return next();
  }
  action(prefix, val, next);
}

function checkUnique(prefix, paths, doc, next) {
  function performCheckUnique(path, val, cb) {
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
  function doSaveUnique(path, val, cb) {
    var entry = new UniqueModel();
    entry._id = {};
    entry._id.collection = doc.constructor.collection.name;
    entry.set('_id.vals.' + path, val);
    entry.refId = doc._id;
    entry.save(cb);
  }
  performActionForAll(prefix, paths, doc, doSaveUnique, next);
}

function storeCurrentVals(prefix, paths, doc, next) {
  function storeValue(path, val, cb) {
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
  schema.post('init', function() {
    var uniquePaths = getPaths(this.schema);
    storeCurrentVals('', uniquePaths, this, function() {
      console.log('stored info');
    });
  });
  schema.pre('validate', function(next) {
    var uniquePaths = getPaths(this.schema);
    checkUnique('', uniquePaths, this, next);
  });
  schema.pre('save', function(next) {
    var uniquePaths = getPaths(this.schema);
    saveUnique('', uniquePaths, this, next);
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