"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "getRootDirs", {
    enumerable: true,
    get: function() {
        return getRootDirs;
    }
});
var _path = require("node:path");
/**
 * Čekis has one Next.js app at the ESLint working directory. The upstream
 * helper expands monorepo globs with fast-glob; this project does not need
 * that behavior or its vulnerable transitive brace parser.
 */
var getRootDirs = function(context) {
    var nextSettings = context.settings.next || {};
    var rootDir = nextSettings.rootDir;
    if (rootDir === undefined) {
        return [
            context.cwd
        ];
    }
    if (typeof rootDir !== 'string' || !rootDir.trim() || [
        '*',
        '?',
        '[',
        ']',
        '{',
        '}',
        '!'
    ].some(function(char) {
        return rootDir.includes(char);
    }) || _path.resolve(context.cwd, rootDir) !== _path.resolve(context.cwd)) {
        throw new Error('Čekis Next lint supports only the project root; remove rootDir globs or sub-app paths.');
    }
    return [
        context.cwd
    ];
};
