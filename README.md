# mongoose-unique-shard
When sharding unique indexes are only allowed for keys matching the shard index. This module allows to still define other properties to be unique which will then be modelled using an additional collection to keep track of unique fields.
