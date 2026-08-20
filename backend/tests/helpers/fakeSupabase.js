// Minimal stand-in for the supabase-js query builder used by route tests.
// server.js constructs its supabase client once at module load, so tests
// share a single fake client instance and call `setResult(table, result)`
// before each request to configure what that request's query resolves to.
// Chain methods (select/eq/order/limit/upsert/insert/...) just return the
// same builder; the builder itself is thenable so `await` at any point in
// the chain resolves to the configured result, matching real supabase-js.

const CHAIN_METHODS = [
  "select",
  "eq",
  "neq",
  "order",
  "limit",
  "upsert",
  "insert",
  "update",
  "delete",
];

function makeBuilder(result, recordCall) {
  const builder = {};
  for (const method of CHAIN_METHODS) {
    builder[method] = (...args) => {
      recordCall(method, args);
      return builder;
    };
  }
  builder.single = () => {
    recordCall("single", []);
    return Promise.resolve(result);
  };
  builder.maybeSingle = () => {
    recordCall("maybeSingle", []);
    return Promise.resolve(result);
  };
  builder.then = (resolve, reject) =>
    Promise.resolve(result).then(resolve, reject);
  return builder;
}

function createFakeSupabase() {
  const state = {};
  const calls = [];

  return {
    /**
     * @param {string} table
     * @param {{data, error}|Array<{data, error}>} result - an array is
     *   consumed one entry per `.from(table)` call (for retry-loop routes
     *   like /share); a single object is reused for every call.
     */
    setResult(table, result) {
      state[table] = Array.isArray(result) ? [...result] : result;
    },
    from(table) {
      if (!(table in state)) {
        throw new Error(`fakeSupabase: no result configured for table "${table}"`);
      }
      const entry = state[table];
      const result = Array.isArray(entry)
        ? entry.length > 1
          ? entry.shift()
          : entry[0]
        : entry;
      return makeBuilder(result, (method, args) => {
        calls.push({ table, method, args });
      });
    },
    calls,
  };
}

module.exports = { createFakeSupabase };
