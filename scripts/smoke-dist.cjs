// Verifies the published CommonJS build works through the package's own exports map.
const assert = require('node:assert/strict');
const { createQuerybar, stringify } = require('querybar');

const search = createQuerybar({ fields: { is: { type: 'enum', values: ['open', 'closed'] } } });
assert.equal(search.filter([{ is: 'open' }, { is: 'closed' }], '-is:open').length, 1);
assert.equal(stringify(search.parse('NOT is:open').ast), '-is:open');
assert.equal(search.parse('is:opne').diagnostics[0].suggestion, 'open');
console.log('CJS build OK');
