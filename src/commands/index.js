// Command registry. To add a command: create a file in this folder exporting
// { data, execute } and add it to the `list` below — registration, dispatch, and
// the /help listing all pick it up automatically.

const list = [
  require('./ping'),
  require('./convert'),
  require('./sources'),
  require('./toggle'),
  require('./stats'),
  require('./help'),
];

const byName = new Map(list.map((c) => [c.data.name, c]));

module.exports = { list, byName };
