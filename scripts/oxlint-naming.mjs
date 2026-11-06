// Oxlint plugin with the naming rules of the repository (see .oxlintrc.json):
// - naming/private-underscore: private and protected class members and constructor parameter properties start with `_`
// - naming/type-pascal-case: classes, interfaces, type aliases and enums are PascalCase
// The line after an `eslint-disable-next-line @typescript-eslint/naming-convention` comment (from the ESLint setup) is skipped.

const pascalCase = /^[A-Z][A-Za-z0-9]*$/

/** Reports, except on the lines after an old `eslint-disable-next-line @typescript-eslint/naming-convention` comment */
function reporter(context) {
    const skipped = new Set(context.sourceCode.getAllComments()
        .filter(c => /eslint-disable-next-line\s+@typescript-eslint\/naming-convention/.test(c.value))
        .map(c => c.loc.end.line + 1))
    return (node, message) => {
        if (!skipped.has(node.loc.start.line)) context.report({node, message})
    }
}

function keyName(node) {
    return !node.computed && node.key?.type === 'Identifier' ? node.key.name : undefined
}

const privateUnderscore = {
    meta: {type: 'suggestion', docs: {description: 'Private and protected members start with `_`'}},
    create(context) {
        const report = reporter(context)
        function check(node, name, nameNode) {
            if (node.accessibility !== 'private' && node.accessibility !== 'protected') return
            if (!name || name.startsWith('_')) return
            report(nameNode, `${node.accessibility} member \`${name}\` must start with \`_\``)
        }
        function member(node) {
            if (node.kind === 'constructor') return
            check(node, keyName(node), node.key)
        }
        return {
            MethodDefinition: member,
            PropertyDefinition: member,
            AccessorProperty: member,
            TSAbstractMethodDefinition: member,
            TSAbstractPropertyDefinition: member,
            TSAbstractAccessorProperty: member,
            TSParameterProperty(node) {
                const param = node.parameter.type === 'AssignmentPattern' ? node.parameter.left : node.parameter
                if (param.type === 'Identifier') check(node, param.name, param)
            },
        }
    },
}

const typePascalCase = {
    meta: {type: 'suggestion', docs: {description: 'Classes, interfaces, type aliases and enums are PascalCase'}},
    create(context) {
        const report = reporter(context)
        function check(node) {
            const name = node.id?.name
            if (name && !pascalCase.test(name)) report(node.id, `\`${name}\` must be PascalCase`)
        }
        return {
            ClassDeclaration: check,
            TSInterfaceDeclaration: check,
            TSTypeAliasDeclaration: check,
            TSEnumDeclaration: check,
        }
    },
}

export default {
    meta: {name: 'naming'},
    rules: {
        'private-underscore': privateUnderscore,
        'type-pascal-case': typePascalCase,
    },
}
