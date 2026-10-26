const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

// Exercise the actual touch handlers without starting the canvas renderer.
const source = fs.readFileSync(
    path.join(__dirname, '../src/morphic.js'), 'utf8'
);
const handlers = source.slice(
    source.indexOf('HandMorph.prototype.processTouchStart ='),
    source.indexOf('HandMorph.prototype.processMouseUp =')
);

function fixture(ancestors = []) {
    let timer;
    const events = [];
    function Point(x, y) { this.x = x; this.y = y; }
    Point.prototype.divideBy = function (n) {
        return new Point(this.x / n, this.y / n);
    };
    Point.prototype.distanceTo = function (point) {
        return Math.hypot(this.x - point.x, this.y - point.y);
    };
    const context = {
        HandMorph: function () {}, Point, ZOOM: 1,
        MorphicPreferences: {grabThreshold: 5}, nop() {},
        setInterval(callback, delay) {
            assert.equal(delay, 400);
            timer = callback;
            return 1;
        },
        clearInterval() { timer = null; }
    };
    vm.createContext(context);
    vm.runInContext(handlers, context);
    const hand = new context.HandMorph();
    hand.world = {cursor: null};
    hand.morphAtPointer = () => ({allParents: () => ancestors});
    hand.processMouseMove = () => {};
    hand.processMouseDown = event => events.push(['down', event.button]);
    hand.processMouseUp = event => events.push(['up', event.button]);
    const touch = (x = 10, y = 10) => ({
        touches: [{pageX: x, pageY: y}], preventDefault() {}
    });
    return {
        hand, events, touch,
        hold() { if (timer) { timer(); } },
        hasTimer() { return Boolean(timer); }
    };
}

test('a short tap remains a left click and cancels the hold', () => {
    const f = fixture();
    f.hand.processTouchStart(f.touch());
    f.hand.processTouchEnd({});
    f.hold();
    assert.deepEqual(f.events, [['down', 0], ['up', 0]]);
    assert.equal(f.hasTimer(), false);
});

test('holding editable text preserves the left click', () => {
    const f = fixture([{isEditable: true}]);
    f.hand.processTouchStart(f.touch());
    f.hold();
    assert.equal(f.hasTimer(), false);
    f.hand.processTouchEnd({});
    assert.deepEqual(f.events, [['down', 0], ['up', 0]]);
});

test('holding a child of editable text also preserves editing', () => {
    const f = fixture([{}, {isEditable: true}, {}]);
    f.hand.processTouchStart(f.touch());
    f.hold();
    assert.deepEqual(f.events, [['down', 0]]);
});

test('holding input padding or its cursor preserves editing', () => {
    const input = {};
    const f = fixture([{}, input]);
    f.hand.processMouseDown = event => {
        f.events.push(['down', event.button]);
        f.hand.world.cursor = {target: {parent: input}};
    };
    f.hand.processTouchStart(f.touch());
    f.hold();
    f.hand.processTouchEnd({});
    assert.deepEqual(f.events, [['down', 0], ['up', 0]]);
});

test('holding a block still opens its context menu', () => {
    const f = fixture([{}]);
    f.hand.processTouchStart(f.touch());
    f.hold();
    assert.deepEqual(f.events, [['down', 0], ['down', 2], ['up', 2]]);
    assert.equal(f.hasTimer(), false);
});

test('editing elsewhere does not suppress a block context menu', () => {
    const f = fixture([{}]);
    f.hand.world.cursor = {target: {parent: {}}};
    f.hand.processTouchStart(f.touch());
    f.hold();
    assert.deepEqual(f.events, [['down', 0], ['down', 2], ['up', 2]]);
});

test('dragging beyond the threshold cancels the context menu', () => {
    const f = fixture([{}]);
    f.hand.processTouchStart(f.touch());
    f.hand.processTouchMove(f.touch(30, 10));
    f.hold();
    assert.deepEqual(f.events, [['down', 0]]);
    assert.equal(f.hasTimer(), false);
});

test('small finger movements preserve the hold on a block', () => {
    const f = fixture([{}]);
    f.hand.processTouchStart(f.touch());
    f.hand.processTouchMove(f.touch(11, 10));
    f.hold();
    assert.deepEqual(f.events, [['down', 0], ['down', 2], ['up', 2]]);
});
