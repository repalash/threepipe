module.exports = {
    'root': true,
    'extends': [
        'eslint:recommended',
    ],
    'parserOptions': {
        'ecmaVersion': 2018,
    },
    'plugins': [
        'html',
    ],
    'settings': {
        'html/indent': 4,
    },
    'env': {
        'es6': true,
        'node': true,
    },
    'rules': {
        'array-bracket-spacing': 'error',
        'comma-style': 'error',
        'space-before-blocks': 'error',
        'space-before-function-paren': 'error',
        'space-in-parens': 'error',
        'space-infix-ops': 'error',
        'space-unary-ops': 'error',
        'spaced-comment': 'error',
        'no-spaced-func': 'error',
        'no-multi-spaces': 'error',
        'no-regex-spaces': 'error',
        'no-trailing-spaces': ['warn', { 'skipBlankLines': true }],
        'no-mixed-spaces-and-tabs': 'error',
        'no-irregular-whitespace': 'error',
        'no-whitespace-before-property': 'error',
        'default-case': 'error',
        'require-jsdoc': 'warn',
        'camelcase': 'error',
        'comma-dangle': ['error', 'always-multiline'],
        'indent': ['error', 4],
        'quotes': ['error', 'single'],
        'linebreak-style': ['error', 'unix'],
        'no-loss-of-precision': 'error',
    },
    'overrides': [
        {
            'files': ['**/*.ts', '**/*.tsx'],

            'parser': '@typescript-eslint/parser', // Specifies the ESLint parser
            'parserOptions': {
                'ecmaVersion': 2021, // Allows for the parsing of modern ECMAScript features
                'sourceType': 'module', // Allows for the use of imports
                'project': ['./tsconfig.json', './examples/tsconfig.json'],
                'tsconfigRootDir': './',
            },
            'extends': [
                'eslint:recommended',
                'plugin:@typescript-eslint/eslint-recommended' ,
                'plugin:@typescript-eslint/recommended', // Uses the recommended rules from the @typescript-eslint/eslint-plugin
            ],
            'env': {
                'browser': true,
                'es6': true,
            },
            'plugins': [
                'html',
                '@typescript-eslint',
                'import',
                'deprecation',
            ],
            'settings': {
                'html/indent': 4,
                'import/resolver': {
                    'typescript': {},
                },
            },
            'rules': {
                // Place to specify ESLint rules. Can be used to overwrite rules specified from the extended configs
                // e.g. "@typescript-eslint/explicit-function-return-type": "off",
                '@typescript-eslint/no-explicit-any': 'off',
                'camelcase': 'off',
                '@typescript-eslint/naming-convention': [ // https://github.com/typescript-eslint/typescript-eslint/blob/master/packages/eslint-plugin/docs/rules/naming-convention.md
                    'error',
                    {
                        'selector': 'default',
                        'format': ['camelCase', 'snake_case', 'PascalCase'],
                    },
                    {
                        'selector': 'variable',
                        'format': ['camelCase', 'UPPER_CASE'],
                    },
                    {
                        'selector': 'parameter',
                        'format': ['camelCase'],
                        'leadingUnderscore': 'allow',
                    },
                    {
                        'selector': 'memberLike',
                        'modifiers': ['private'],
                        'format': ['camelCase'],
                        'leadingUnderscore': 'require',
                    },
                    {
                        'selector': 'memberLike',
                        'modifiers': ['protected'],
                        'format': ['camelCase'],
                        'leadingUnderscore': 'require',
                    },
                    {
                        'selector': ['typeLike'],
                        'format': ['PascalCase'],
                    },
                    {
                        'selector': ['enumMember'],
                        'format': ['PascalCase', 'UPPER_CASE'],
                    },
                    {
                        'selector': 'memberLike',
                        'modifiers': ['static'],
                        'format': ['PascalCase', 'UPPER_CASE'],
                    },
                    {
                        'selector': 'objectLiteralProperty',
                        'format': ['camelCase', 'snake_case', 'PascalCase'],
                        'leadingUnderscore': 'allowSingleOrDouble',
                    },
                    {
                        'selector': 'typeProperty',
                        'format': ['camelCase', 'snake_case', 'PascalCase', 'UPPER_CASE'],
                        'leadingUnderscore': 'allowSingleOrDouble',
                    },
                ],
                'semi': 'off',
                '@typescript-eslint/semi': ['error','never', { 'beforeStatementContinuationChars': 'always' }],
                'no-extra-semi': 'off',
                '@typescript-eslint/no-extra-semi': ['error'],
                '@typescript-eslint/adjacent-overload-signatures': 'error',
                'comma-spacing': 'off',
                '@typescript-eslint/comma-spacing': ['error'],
                'no-extra-parens': 'off',
                '@typescript-eslint/no-extra-parens': ['error'],
                'brace-style': 'off',
                '@typescript-eslint/brace-style': ['warn', '1tbs', { 'allowSingleLine': true }],
                '@typescript-eslint/consistent-type-definitions': ['error', 'interface'],
                'default-param-last': 'off',
                '@typescript-eslint/default-param-last': ['error'],
                'func-call-spacing': 'off',
                '@typescript-eslint/func-call-spacing': ['error'],
                'keyword-spacing': 'off',
                'object-curly-spacing': 'off',
                '@typescript-eslint/object-curly-spacing': ['error'],
                '@typescript-eslint/keyword-spacing': ['error'],
                'space-before-function-paren': 'off',
                '@typescript-eslint/space-before-function-paren': ['error','never'],
                'no-shadow': 'off',
                'no-magic-numbers': 'off',
                // '@typescript-eslint/no-magic-numbers': [
                //     'warn', {
                //         'ignoreEnums': true,
                //         'ignoreNumericLiteralTypes': true,
                //         'ignoreReadonlyClassProperties': true,
                //     },
                // ],
                '@typescript-eslint/promise-function-async': [
                    'error',
                    {
                        'allowedPromiseNames': ['Thenable'],
                        'checkArrowFunctions': true,
                        'checkFunctionDeclarations': true,
                        'checkFunctionExpressions': true,
                        'checkMethodDeclarations': true,
                    },
                ],
                'dot-notation': 'off', // https://github.com/typescript-eslint/typescript-eslint/blob/master/packages/eslint-plugin/docs/rules/dot-notation.md
                '@typescript-eslint/dot-notation': ['error'],
                '@typescript-eslint/prefer-string-starts-ends-with': 'error',
                '@typescript-eslint/prefer-includes': 'error',
                '@typescript-eslint/prefer-for-of': 'error',
                '@typescript-eslint/prefer-as-const': 'error',
                '@typescript-eslint/prefer-function-type': 'error',
                '@typescript-eslint/no-unsafe-call': 'warn',
                '@typescript-eslint/no-misused-new': 'error',
                '@typescript-eslint/no-namespace': 'error',
                '@typescript-eslint/non-nullable-type-assertion-style': 'error',
                'no-invalid-this': 'off',
                '@typescript-eslint/no-invalid-this': ['error'],
                '@typescript-eslint/prefer-ts-expect-error': ['error'],
                'no-loop-func': 'off',
                '@typescript-eslint/no-loop-func': ['error'],
                'no-loss-of-precision': 'off',
                '@typescript-eslint/no-loss-of-precision': ['error'],
                '@typescript-eslint/no-shadow': ['error'],
                'no-duplicate-imports': 'off',
                '@typescript-eslint/no-duplicate-imports': ['error', { 'includeExports': false }],
                // "@typescript-eslint/prefer-nullish-coalescing": ["error", {ignoreConditionalTests: false, ignoreMixedLogicalExpressions: false}],
                'comma-dangle': 'off',
                '@typescript-eslint/comma-dangle': ['error', {
                    'arrays': 'always-multiline',
                    'objects': 'always-multiline',
                    'imports': 'always-multiline',
                    'exports': 'always-multiline',
                    'functions': 'only-multiline',
                }],
                'deprecation/deprecation': 'warn',

            },

            'globals': { 'Atomics': 'readonly', 'SharedArrayBuffer': 'readonly' },
        },
    ],
}
