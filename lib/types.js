'use strict';

// Adapted from: https://github.com/SamVerschueren/tsd, copyright (c) 2018-2019 Sam Verschueren, MIT licensed

const Fs = require('fs');
const Path = require('path');

const Globby = require('globby');
const Hoek = require('@hapi/hoek');
const Ts = require('typescript');


const internals = {
    compiler: {
        strict: true,
        jsx: Ts.JsxEmit.React,
        lib: ['lib.es2018.d.ts'],
        module: Ts.ModuleKind.CommonJS,
        target: Ts.ScriptTarget.ES2018,
        moduleResolution: Ts.ModuleResolutionKind.NodeJs
    },

    skip: [
        1308                                        // AwaitIsOnlyAllowedInAsyncFunction
    ],

    report: [
        2345,                                       // ArgumentTypeIsNotAssignableToParameterType
        2339,                                       // PropertyDoesNotExistOnType
        2540,                                       // CannotAssignToReadOnlyProperty
        2322,                                       // TypeIsNotAssignableToOtherType
        2314,                                       // GenericTypeRequiresTypeArguments
        2554                                        // ExpectedArgumentsButGotOther
    ]
};


exports.expect = {
    error: Hoek.ignore,
    type: Hoek.ignore
};


exports.validate = async (options = {}) => {

    const cwd = process.cwd();
    const pkg = require(Path.join(cwd, 'package.json'));

    if (!pkg.types) {
        return [{ filename: 'package.json', message: 'File missing "types" property' }];
    }

    if (!Fs.existsSync(Path.join(cwd, pkg.types))) {
        return [{ filename: pkg.types, message: 'Cannot find types file' }];
    }

    if (pkg.files) {
        const packaged = await Globby(pkg.files, { cwd });
        if (!packaged.includes(pkg.types)) {
            return [{ filename: 'package.json', message: 'Types file is not covered by "files" property' }];
        }
    }

    const testFiles = await Globby(options['types-test'] || 'test/**/*.ts', { cwd, absolute: true });
    if (!testFiles.length) {
        return [{ filename: pkg.types, message: 'Cannot find tests for types file' }];
    }

    const program = Ts.createProgram(testFiles, internals.compiler);

    const diagnostics = [
        ...program.getSemanticDiagnostics(),
        ...program.getSyntacticDiagnostics()
    ];

    const errors = internals.extractErrors(program);

    const result = [];
    for (const diagnostic of diagnostics) {
        if (internals.ignore(diagnostic, errors)) {
            continue;
        }

        const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);

        result.push({
            filename: diagnostic.file.fileName,
            message: Ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
            line: position.line + 1,
            column: position.character
        });
    }

    for (const [, diagnostic] of errors) {
        result.push({
            ...diagnostic,
            message: 'Expected an error'
        });
    }

    for (const error of result) {
        error.filename = error.filename.slice(process.cwd().length + 1);
    }

    return result;
};


internals.extractErrors = function (program) {

    const errors = new Map();

    const extract = (node) => {

        if (node.kind === Ts.SyntaxKind.ExpressionStatement &&
            node.getText().startsWith('expect.error')) {

            const location = {
                filename: node.getSourceFile().fileName,
                start: node.getStart(),
                end: node.getEnd()
            };

            const pos = node.getSourceFile().getLineAndCharacterOfPosition(node.getStart());
            errors.set(location, {
                filename: location.filename,
                line: pos.line + 1,
                column: pos.character
            });
        }

        Ts.forEachChild(node, extract);
    };

    for (const sourceFile of program.getSourceFiles()) {
        extract(sourceFile);
    }

    return errors;
};


internals.ignore = function (diagnostic, expectedErrors) {

    if (internals.skip.includes(diagnostic.code)) {
        return true;
    }

    if (!internals.report.includes(diagnostic.code)) {
        return false;
    }

    for (const [location] of expectedErrors) {
        if (diagnostic.file.fileName === location.filename &&
            diagnostic.start > location.start &&
            diagnostic.start < location.end) {

            expectedErrors.delete(location);
            return true;
        }
    }

    return false;
};