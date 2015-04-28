'use strict';

var mongoose = require('mongoose');
var Schema = mongoose.Schema;
var _ = require('lodash');
var async = require('async');
var dotty = require("dotty");

var uniqueSchema = new Schema({
  _id: {
    type: {
      _id: false,
      collection: String,
      vals: Schema.Types.Mixed
    }, unique: true
  },
  refId: Schema.Types.Mixed
}, {
  versionKey: false,
  autoIndex: false,
  shardKey: {
    _id: 'hashed'
  }
});
var UniqueModel = mongoose.model('mongooseUniqueShard', uniqueSchema);

function getValues(doc, paths) {
  var final = [];
  _.forEach(paths, function(path) {
    final.push(doc.get(path));
  });
  return final;
}

function getExistingValues(doc, paths) {
  var final = [];
  _.forEach(paths, function(path) {
    var val;
    if (doc._uniqueShard && doc._uniqueShard.initVals) {
      val = doc._uniqueShard.initVals[path];
    }
    return final.push(val);
  });
  return final;
}

function isNot(val) {
  return !val;
}

function performActionForAll(indexes, doc, action, next) {
  return async.each(indexes, function(paths, cb) {
    var vals = getValues(doc, paths);
    var existingVals = getExistingValues(doc, paths);
    if (_.every(vals, isNot) && _.every(vals, isNot)) {
      return cb();
    }
    action(paths, vals, existingVals, cb);
  }, next);
}

function checkUnique(paths, doc, next) {
  function performCheckUnique(paths, vals, existingVals, cb) {
    var query = { '_id.collection': doc.constructor.collection.name };
    _.times(paths.length, function(i) {
      query['_id.vals.' + paths[i]] = vals[i];
    });
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
        return cb(new Error('values ' + JSON.stringify(vals) + ' for paths ' + JSON.stringify(paths) + ' are not unique'));
      });
    });
  }

  performActionForAll(paths, doc, performCheckUnique, next);
}

function saveUnique(paths, doc, next) {
  function doSaveUnique(paths, vals, existingVals, cb) {
    var entry = new UniqueModel();
    entry._id = {};
    entry._id.collection = doc.constructor.collection.name;
    entry._id.vals = {};
    _.times(paths.length, function(i) {
      dotty.put(entry._id.vals, paths[i], vals[i]);
    });
    entry.refId = doc._id;
    entry.save(cb);
  }
  performActionForAll(paths, doc, doSaveUnique, next);
}

function removeExistingUnique(paths, doc, next) {
  function doRemoveUnique(paths, vals, existingVals, cb) {
    var query = { '_id.collection': doc.constructor.collection.name };
    _.times(paths.length, function(i) {
      query['_id.vals.' + paths[i]] = existingVals[i];
    });
    UniqueModel.remove(query, next);
  }

  performActionForAll(paths, doc, doRemoveUnique, next);
}

function storeCurrentVals(paths, doc, next) {
  function storeValue(paths, vals, existingVals, cb) {
    if (!doc._uniqueShard) {
      Object.defineProperty(doc, '_uniqueShard', { enumerable: false, value: {} });
      doc._uniqueShard.initVals = {};
    }
    _.times(paths.length, function(i) {
      doc._uniqueShard.initVals[paths[i]] = vals[i];
    });
    return cb();
  }

  performActionForAll(paths, doc, storeValue, next);
}

module.exports = function(schema) {
  var forgetCb = function() {
  };
  schema._uniqueShard = {};
  schema._uniqueShard.paths = getPaths('', schema);
  schema.addUniqueShardIndex = function(indexes) {
    if (_.isString(indexes)) {
      indexes = [indexes];
    };
    if (!_.isArray(indexes)) {
      throw new Error('can only add single path as string or array of strings as a path');
    }
    _.forEach(indexes, function(index) {
      if (!_.isString(index)) {
        throw new Error('can only add single path as string or array of strings as a path');
      }
    });
    schema._uniqueShard.paths.push(indexes);
  }
  schema.pre('init', function(next) {
    var doc = this;
    doc.on('init', function() {
      storeCurrentVals(doc.schema._uniqueShard.paths, doc, forgetCb);
    });
    next();
  });
  schema.pre('validate', function(next) {
    var doc = this;
    checkUnique(doc.schema._uniqueShard.paths, doc, next);
  });
  schema.pre('save', function(next) {
    var doc = this;
    removeExistingUnique(doc.schema._uniqueShard.paths, doc, function(err) {
      if (err) {
        return next(err);
      }
      saveUnique(doc.schema._uniqueShard.paths, doc, next);
    });
  });
  schema.post('save', function() {
    var doc = this;
    storeCurrentVals(doc.schema._uniqueShard.paths, doc, forgetCb);
  });
  schema.post('remove', function() {
    var doc = this;
    removeExistingUnique(doc.schema._uniqueShard.paths, doc, forgetCb);
  });
};

function getPaths(parentPath, schema) {
  return _.reduce(schema.tree, function(memo, node, path) {
    var p = isUnique(parentPath, node, path);
    if (p) {
      memo.push.apply(memo, p);
    }
    return memo;
  }, []);
}

function isUnique(parentPath, node, path) {
  if (!node) {
    return [];
  }
  var completePath = path;
  if (parentPath) {
    completePath = parentPath + '.' + path;
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
    var o = getPaths(completePath, s);

    return _.isEmpty(o) ? [] : o;
  } else if (node.uniqueShardIndex) {
    return [[completePath]];
  }
}