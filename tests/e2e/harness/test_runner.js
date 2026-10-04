/**
 * Juris Banking - E2E Test Runner & Assertion Engine
 * Self-contained, zero-dependency, high-performance test runner for Node 20+
 */

const util = require('node:util');

const COLORS = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
};

class AssertionError extends Error {
  constructor(message, actual, expected) {
    super(message);
    this.name = 'AssertionError';
    this.actual = actual;
    this.expected = expected;
  }
}

class Expectation {
  constructor(actual, isNot = false) {
    this.actual = actual;
    this.isNot = isNot;
  }

  get not() {
    return new Expectation(this.actual, !this.isNot);
  }

  _assert(condition, message, expected) {
    const passed = this.isNot ? !condition : condition;
    if (!passed) {
      const fullMessage = this.isNot
        ? `Expected value NOT to satisfy condition: ${message}`
        : `Assertion failed: ${message}`;
      throw new AssertionError(fullMessage, this.actual, expected);
    }
  }

  toBe(expected) {
    this._assert(
      Object.is(this.actual, expected),
      `Expected ${util.inspect(this.actual)} to be ${util.inspect(expected)}`,
      expected
    );
  }

  toEqual(expected) {
    const isEq = deepEqual(this.actual, expected);
    this._assert(
      isEq,
      `Expected ${util.inspect(this.actual)} to deep-equal ${util.inspect(expected)}`,
      expected
    );
  }

  toBeDefined() {
    this._assert(
      this.actual !== undefined,
      `Expected value to be defined, but received undefined`,
      'defined'
    );
  }

  toBeUndefined() {
    this._assert(
      this.actual === undefined,
      `Expected undefined, but received ${util.inspect(this.actual)}`,
      undefined
    );
  }

  toBeNull() {
    this._assert(
      this.actual === null,
      `Expected null, but received ${util.inspect(this.actual)}`,
      null
    );
  }

  toBeTruthy() {
    this._assert(
      Boolean(this.actual),
      `Expected truthy value, but received ${util.inspect(this.actual)}`,
      true
    );
  }

  toBeFalsy() {
    this._assert(
      !this.actual,
      `Expected falsy value, but received ${util.inspect(this.actual)}`,
      false
    );
  }

  toBeGreaterThan(expected) {
    this._assert(
      this.actual > expected,
      `Expected ${this.actual} to be greater than ${expected}`,
      `> ${expected}`
    );
  }

  toBeGreaterThanOrEqual(expected) {
    this._assert(
      this.actual >= expected,
      `Expected ${this.actual} to be >= ${expected}`,
      `>= ${expected}`
    );
  }

  toBeLessThan(expected) {
    this._assert(
      this.actual < expected,
      `Expected ${this.actual} to be less than ${expected}`,
      `< ${expected}`
    );
  }

  toBeLessThanOrEqual(expected) {
    this._assert(
      this.actual <= expected,
      `Expected ${this.actual} to be <= ${expected}`,
      `<= ${expected}`
    );
  }

  toBeCloseTo(expected, delta = 0.001) {
    const diff = Math.abs(this.actual - expected);
    this._assert(
      diff <= delta,
      `Expected ${this.actual} to be close to ${expected} (within ${delta}, actual diff: ${diff})`,
      expected
    );
  }

  toMatch(regex) {
    const reg = typeof regex === 'string' ? new RegExp(regex) : regex;
    this._assert(
      reg.test(String(this.actual)),
      `Expected ${util.inspect(this.actual)} to match pattern ${reg}`,
      reg
    );
  }

  toInclude(item) {
    if (typeof this.actual === 'string') {
      this._assert(
        this.actual.includes(item),
        `Expected string to include substring "${item}"`,
        item
      );
    } else if (Array.isArray(this.actual)) {
      this._assert(
        this.actual.some((x) => deepEqual(x, item) || x === item),
        `Expected array to include item ${util.inspect(item)}`,
        item
      );
    } else if (this.actual && typeof this.actual === 'object') {
      this._assert(
        item in this.actual,
        `Expected object to have key "${item}"`,
        item
      );
    } else {
      this._assert(false, `toInclude cannot be used on type ${typeof this.actual}`, item);
    }
  }

  toHaveLength(expected) {
    const len = this.actual ? this.actual.length : undefined;
    this._assert(
      len === expected,
      `Expected length ${expected}, but received length ${len}`,
      expected
    );
  }

  toHaveProperty(prop, value) {
    const hasProp = this.actual != null && Object.prototype.hasOwnProperty.call(this.actual, prop);
    if (value !== undefined) {
      this._assert(
        hasProp && deepEqual(this.actual[prop], value),
        `Expected property "${prop}" with value ${util.inspect(value)}, got ${util.inspect(this.actual?.[prop])}`,
        value
      );
    } else {
      this._assert(hasProp, `Expected object to have property "${prop}"`, prop);
    }
  }

  async toThrow(expectedError) {
    let threw = false;
    let thrownError;
    if (typeof this.actual === 'function') {
      try {
        const res = this.actual();
        if (res && typeof res.then === 'function') {
          await res;
        }
      } catch (err) {
        threw = true;
        thrownError = err;
      }
    } else {
      throw new Error('toThrow requires a function');
    }

    if (expectedError) {
      if (typeof expectedError === 'string') {
        this._assert(
          threw && thrownError.message.includes(expectedError),
          `Expected error containing "${expectedError}", but got ${thrownError ? thrownError.message : 'no error'}`,
          expectedError
        );
      } else if (expectedError instanceof RegExp) {
        this._assert(
          threw && expectedError.test(thrownError.message),
          `Expected error matching ${expectedError}, but got ${thrownError ? thrownError.message : 'no error'}`,
          expectedError
        );
      } else {
        this._assert(
          threw && thrownError instanceof expectedError,
          `Expected error of type ${expectedError.name}, but got ${thrownError}`,
          expectedError
        );
      }
    } else {
      this._assert(threw, `Expected function to throw an error, but it did not throw`, 'error');
    }
  }
}

function deepEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) {
    return false;
  }
  if (a instanceof Date && b instanceof Date) {
    return a.getTime() === b.getTime();
  }
  if (a instanceof RegExp && b instanceof RegExp) {
    return a.toString() === b.toString();
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
    if (!deepEqual(a[key], b[key])) return false;
  }
  return true;
}

class TestSuite {
  constructor(name, parent = null) {
    this.name = name;
    this.parent = parent;
    this.tests = [];
    this.suites = [];
    this.beforeHooks = [];
    this.afterHooks = [];
    this.beforeEachHooks = [];
    this.afterEachHooks = [];
  }

  addTest(name, fn, options = {}) {
    this.tests.push({ name, fn, options, suite: this });
  }

  addSuite(suite) {
    this.suites.push(suite);
  }
}

class TestRunner {
  constructor() {
    this.rootSuite = new TestSuite('Root');
    this.currentSuite = this.rootSuite;
    this.results = [];
    this.filter = null;
    this.verbose = false;
    this.timeoutMs = 30000;
  }

  describe(name, fn) {
    const suite = new TestSuite(name, this.currentSuite);
    this.currentSuite.addSuite(suite);
    const prevSuite = this.currentSuite;
    this.currentSuite = suite;
    try {
      fn();
    } finally {
      this.currentSuite = prevSuite;
    }
  }

  it(name, fn, options = {}) {
    this.currentSuite.addTest(name, fn, options);
  }

  before(fn) {
    this.currentSuite.beforeHooks.push(fn);
  }

  after(fn) {
    this.currentSuite.afterHooks.push(fn);
  }

  beforeEach(fn) {
    this.currentSuite.beforeEachHooks.push(fn);
  }

  afterEach(fn) {
    this.currentSuite.afterEachHooks.push(fn);
  }

  expect(actual) {
    return new Expectation(actual);
  }

  getAncestryHooks(suite, type) {
    const hooks = [];
    let s = suite;
    while (s) {
      if (s[type]) {
        hooks.unshift(...s[type]);
      }
      s = s.parent;
    }
    return hooks;
  }

  async runSuite(suite, depth = 0) {
    const indent = '  '.repeat(depth);
    if (suite !== this.rootSuite) {
      console.log(`${indent}${COLORS.bold}${COLORS.cyan}${suite.name}${COLORS.reset}`);
    }

    // Run before hooks
    for (const hook of suite.beforeHooks) {
      await hook();
    }

    // Run tests
    for (const test of suite.tests) {
      const fullTestName = `${suite.name} > ${test.name}`;
      if (this.filter && !fullTestName.toLowerCase().includes(this.filter.toLowerCase())) {
        continue;
      }

      const testIndent = '  '.repeat(depth + 1);
      const start = Date.now();
      let status = 'passed';
      let error = null;

      const beforeEachHooks = this.getAncestryHooks(suite, 'beforeEachHooks');
      for (const bh of beforeEachHooks) {
        try {
          await bh();
        } catch (err) {
          status = 'failed';
          error = new Error(`beforeEach hook failed: ${err.message}`);
          break;
        }
      }

      if (status !== 'failed') {
        try {
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Test timed out after ${test.options.timeout || this.timeoutMs}ms`)), test.options.timeout || this.timeoutMs)
          );
          const executionPromise = Promise.resolve(test.fn());
          await Promise.race([executionPromise, timeoutPromise]);
          status = 'passed';
        } catch (err) {
          status = 'failed';
          error = err;
        }
      }

      const afterEachHooks = this.getAncestryHooks(suite, 'afterEachHooks').reverse();
      for (const ah of afterEachHooks) {
        try {
          await ah();
        } catch (err) {
          if (status !== 'failed') {
            status = 'failed';
            error = new Error(`afterEach hook failed: ${err.message}`);
          }
        }
      }

      const duration = Date.now() - start;
      this.results.push({
        suite: suite.name,
        name: test.name,
        fullName: fullTestName,
        status,
        duration,
        error,
      });

      if (status === 'passed') {
        const timeStr = duration > 50 ? ` ${COLORS.yellow}(${duration}ms)${COLORS.reset}` : ` ${COLORS.gray}(${duration}ms)${COLORS.reset}`;
        console.log(`${testIndent}${COLORS.green}✔${COLORS.reset} ${test.name}${timeStr}`);
      } else {
        console.log(`${testIndent}${COLORS.red}✖ ${test.name}${COLORS.reset} ${COLORS.gray}(${duration}ms)${COLORS.reset}`);
        if (error) {
          console.log(`${testIndent}  ${COLORS.red}${error.message}${COLORS.reset}`);
          if (this.verbose && error.stack) {
            const stackLines = error.stack.split('\n').slice(1, 5).map(l => `${testIndent}  ${COLORS.gray}${l}${COLORS.reset}`).join('\n');
            console.log(stackLines);
          }
        }
      }
    }

    // Run child suites
    for (const childSuite of suite.suites) {
      await this.runSuite(childSuite, depth + 1);
    }

    // Run after hooks
    for (const hook of suite.afterHooks) {
      await hook();
    }
  }

  async run(options = {}) {
    if (options.filter) this.filter = options.filter;
    if (options.verbose) this.verbose = options.verbose;

    console.log(`\n${COLORS.bold}${COLORS.blue}====================================================${COLORS.reset}`);
    console.log(`${COLORS.bold}${COLORS.blue}      JURIS BANKING - AUTOMATED E2E TEST RUNNER     ${COLORS.reset}`);
    console.log(`${COLORS.bold}${COLORS.blue}====================================================${COLORS.reset}\n`);

    const startTime = Date.now();
    await this.runSuite(this.rootSuite);
    const totalDuration = Date.now() - startTime;

    const total = this.results.length;
    const passed = this.results.filter((r) => r.status === 'passed').length;
    const failed = this.results.filter((r) => r.status === 'failed').length;

    console.log(`\n${COLORS.bold}----------------------------------------------------${COLORS.reset}`);
    console.log(`${COLORS.bold}TEST EXECUTION SUMMARY:${COLORS.reset}`);
    console.log(`  Total:    ${total}`);
    console.log(`  Passed:   ${COLORS.green}${passed}${COLORS.reset}`);
    console.log(`  Failed:   ${failed > 0 ? COLORS.red : COLORS.gray}${failed}${COLORS.reset}`);
    console.log(`  Duration: ${(totalDuration / 1000).toFixed(2)}s`);
    console.log(`${COLORS.bold}----------------------------------------------------${COLORS.reset}\n`);

    if (failed > 0) {
      console.log(`${COLORS.bold}${COLORS.red}Failed Tests:${COLORS.reset}`);
      for (const res of this.results.filter((r) => r.status === 'failed')) {
        console.log(`  ${COLORS.red}✖ ${res.fullName}${COLORS.reset}: ${res.error?.message}`);
      }
      console.log('');
    }

    return { total, passed, failed, duration: totalDuration, results: this.results };
  }
}

const defaultRunner = new TestRunner();

module.exports = {
  TestRunner,
  AssertionError,
  Expectation,
  defaultRunner,
  describe: (name, fn) => defaultRunner.describe(name, fn),
  it: (name, fn, opts) => defaultRunner.it(name, fn, opts),
  before: (fn) => defaultRunner.before(fn),
  after: (fn) => defaultRunner.after(fn),
  beforeEach: (fn) => defaultRunner.beforeEach(fn),
  afterEach: (fn) => defaultRunner.afterEach(fn),
  expect: (actual) => defaultRunner.expect(actual),
};
