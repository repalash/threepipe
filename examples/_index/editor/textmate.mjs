// <!--    <script src="https://unpkg.com/onigasm@2.2.5/lib/index.js"></script>-->
// <!--    <script src="https://unpkg.com/monaco-textmate@3.0.1/dist/main.js"></script>-->
// <!--    <script src="https://unpkg.com/monaco-editor-textmate@4.0.0/dist/index.js"></script>-->

// const monacoThemes = [
//     {
//         'id': 'dark-plus',
//         'inherit': 'dark-vs',
//         'name': 'Dark+ (default dark)',
//         'tokenColors': [
//             {
//                 'name': 'Function declarations',
//                 'scope': [
//                     'entity.name.function',
//                     'support.function',
//                     'support.constant.handlebars',
//                     'source.powershell variable.other.member',
//                     'entity.name.operator.custom-literal',
//                 ],
//                 'settings': {
//                     'foreground': '#DCDCAA',
//                 },
//             },
//             {
//                 'name': 'Types declaration and references',
//                 'scope': [
//                     'meta.return-type',
//                     'support.class',
//                     'support.type',
//                     'entity.name.type',
//                     'entity.name.namespace',
//                     'entity.other.attribute',
//                     'entity.name.scope-resolution',
//                     'entity.name.class',
//                     'storage.type.numeric.go',
//                     'storage.type.byte.go',
//                     'storage.type.boolean.go',
//                     'storage.type.string.go',
//                     'storage.type.uintptr.go',
//                     'storage.type.error.go',
//                     'storage.type.rune.go',
//                     'storage.type.cs',
//                     'storage.type.generic.cs',
//                     'storage.type.modifier.cs',
//                     'storage.type.variable.cs',
//                     'storage.type.annotation.java',
//                     'storage.type.generic.java',
//                     'storage.type.java',
//                     'storage.type.object.array.java',
//                     'storage.type.primitive.array.java',
//                     'storage.type.primitive.java',
//                     'storage.type.token.java',
//                     'storage.type.groovy',
//                     'storage.type.annotation.groovy',
//                     'storage.type.parameters.groovy',
//                     'storage.type.generic.groovy',
//                     'storage.type.object.array.groovy',
//                     'storage.type.primitive.array.groovy',
//                     'storage.type.primitive.groovy',
//                 ],
//                 'settings': {
//                     'foreground': '#4EC9B0',
//                 },
//             },
//             {
//                 'name': 'Types declaration and references, TS grammar specific',
//                 'scope': [
//                     'meta.type.cast.expr',
//                     'meta.type.new.expr',
//                     'support.constant.math',
//                     'support.constant.dom',
//                     'support.constant.json',
//                     'entity.other.inherited-class',
//                 ],
//                 'settings': {
//                     'foreground': '#4EC9B0',
//                 },
//             },
//             {
//                 'name': 'Control flow / Special keywords',
//                 'scope': [
//                     'keyword.control',
//                     'source.cpp keyword.operator.new',
//                     'keyword.operator.delete',
//                     'keyword.other.using',
//                     'keyword.other.operator',
//                     'entity.name.operator',
//                 ],
//                 'settings': {
//                     'foreground': '#C586C0',
//                 },
//             },
//             {
//                 'name': 'Variable and parameter name',
//                 'scope': [
//                     'variable',
//                     'meta.definition.variable.name',
//                     'support.variable',
//                     'entity.name.variable',
//                 ],
//                 'settings': {
//                     'foreground': '#9CDCFE',
//                 },
//             },
//             {
//                 'name': 'Constants and enums',
//                 'scope': [
//                     'variable.other.constant',
//                     'variable.other.enummember',
//                 ],
//                 'settings': {
//                     'foreground': '#4FC1FF',
//                 },
//             },
//             {
//                 'name': 'Object keys, TS grammar specific',
//                 'scope': [
//                     'meta.object-literal.key',
//                 ],
//                 'settings': {
//                     'foreground': '#9CDCFE',
//                 },
//             },
//             {
//                 'name': 'CSS property value',
//                 'scope': [
//                     'support.constant.property-value',
//                     'support.constant.font-name',
//                     'support.constant.media-type',
//                     'support.constant.media',
//                     'constant.other.color.rgb-value',
//                     'constant.other.rgb-value',
//                     'support.constant.color',
//                 ],
//                 'settings': {
//                     'foreground': '#CE9178',
//                 },
//             },
//             {
//                 'name': 'Regular expression groups',
//                 'scope': [
//                     'punctuation.definition.group.regexp',
//                     'punctuation.definition.group.assertion.regexp',
//                     'punctuation.definition.character-class.regexp',
//                     'punctuation.character.set.begin.regexp',
//                     'punctuation.character.set.end.regexp',
//                     'keyword.operator.negation.regexp',
//                     'support.other.parenthesis.regexp',
//                 ],
//                 'settings': {
//                     'foreground': '#CE9178',
//                 },
//             },
//             {
//                 'scope': [
//                     'constant.character.character-class.regexp',
//                     'constant.other.character-class.set.regexp',
//                     'constant.other.character-class.regexp',
//                     'constant.character.set.regexp',
//                 ],
//                 'settings': {
//                     'foreground': '#d16969',
//                 },
//             },
//             {
//                 'scope': [
//                     'keyword.operator.or.regexp',
//                     'keyword.control.anchor.regexp',
//                 ],
//                 'settings': {
//                     'foreground': '#DCDCAA',
//                 },
//             },
//             {
//                 'scope': 'keyword.operator.quantifier.regexp',
//                 'settings': {
//                     'foreground': '#d7ba7d',
//                 },
//             },
//             {
//                 'scope': 'constant.character',
//                 'settings': {
//                     'foreground': '#569cd6',
//                 },
//             },
//             {
//                 'scope': 'constant.character.escape',
//                 'settings': {
//                     'foreground': '#d7ba7d',
//                 },
//             },
//             {
//                 'scope': 'entity.name.label',
//                 'settings': {
//                     'foreground': '#C8C8C8',
//                 },
//             },
//         ],
//         'semanticTokenColors': {
//             'newOperator': '#C586C0',
//             'stringLiteral': '#ce9178',
//             'customLiteral': '#DCDCAA',
//             'numberLiteral': '#b5cea8',
//         },
//     },
//     {
//         'id': 'light-plus',
//         'name': 'Light+ (default light)',
//         'inherit': 'light-vs',
//         'tokenColors': [
//             {
//                 'name': 'Function declarations',
//                 'scope': [
//                     'entity.name.function',
//                     'support.function',
//                     'support.constant.handlebars',
//                     'source.powershell variable.other.member',
//                     'entity.name.operator.custom-literal',
//                 ],
//                 'settings': {
//                     'foreground': '#795E26',
//                 },
//             },
//             {
//                 'name': 'Types declaration and references',
//                 'scope': [
//                     'meta.return-type',
//                     'support.class',
//                     'support.type',
//                     'entity.name.type',
//                     'entity.name.namespace',
//                     'entity.other.attribute',
//                     'entity.name.scope-resolution',
//                     'entity.name.class',
//                     'storage.type.numeric.go',
//                     'storage.type.byte.go',
//                     'storage.type.boolean.go',
//                     'storage.type.string.go',
//                     'storage.type.uintptr.go',
//                     'storage.type.error.go',
//                     'storage.type.rune.go',
//                     'storage.type.cs',
//                     'storage.type.generic.cs',
//                     'storage.type.modifier.cs',
//                     'storage.type.variable.cs',
//                     'storage.type.annotation.java',
//                     'storage.type.generic.java',
//                     'storage.type.java',
//                     'storage.type.object.array.java',
//                     'storage.type.primitive.array.java',
//                     'storage.type.primitive.java',
//                     'storage.type.token.java',
//                     'storage.type.groovy',
//                     'storage.type.annotation.groovy',
//                     'storage.type.parameters.groovy',
//                     'storage.type.generic.groovy',
//                     'storage.type.object.array.groovy',
//                     'storage.type.primitive.array.groovy',
//                     'storage.type.primitive.groovy',
//                 ],
//                 'settings': {
//                     'foreground': '#267f99',
//                 },
//             },
//             {
//                 'name': 'Types declaration and references, TS grammar specific',
//                 'scope': [
//                     'meta.type.cast.expr',
//                     'meta.type.new.expr',
//                     'support.constant.math',
//                     'support.constant.dom',
//                     'support.constant.json',
//                     'entity.other.inherited-class',
//                 ],
//                 'settings': {
//                     'foreground': '#267f99',
//                 },
//             },
//             {
//                 'name': 'Control flow / Special keywords',
//                 'scope': [
//                     'keyword.control',
//                     'source.cpp keyword.operator.new',
//                     'source.cpp keyword.operator.delete',
//                     'keyword.other.using',
//                     'keyword.other.operator',
//                     'entity.name.operator',
//                 ],
//                 'settings': {
//                     'foreground': '#AF00DB',
//                 },
//             },
//             {
//                 'name': 'Variable and parameter name',
//                 'scope': [
//                     'variable',
//                     'meta.definition.variable.name',
//                     'support.variable',
//                     'entity.name.variable',
//                 ],
//                 'settings': {
//                     'foreground': '#001080',
//                 },
//             },
//             {
//                 'name': 'Constants and enums',
//                 'scope': [
//                     'variable.other.constant',
//                     'variable.other.enummember',
//                 ],
//                 'settings': {
//                     'foreground': '#0070C1',
//                 },
//             },
//             {
//                 'name': 'Object keys, TS grammar specific',
//                 'scope': [
//                     'meta.object-literal.key',
//                 ],
//                 'settings': {
//                     'foreground': '#001080',
//                 },
//             },
//             {
//                 'name': 'CSS property value',
//                 'scope': [
//                     'support.constant.property-value',
//                     'support.constant.font-name',
//                     'support.constant.media-type',
//                     'support.constant.media',
//                     'constant.other.color.rgb-value',
//                     'constant.other.rgb-value',
//                     'support.constant.color',
//                 ],
//                 'settings': {
//                     'foreground': '#0451a5',
//                 },
//             },
//             {
//                 'name': 'Regular expression groups',
//                 'scope': [
//                     'punctuation.definition.group.regexp',
//                     'punctuation.definition.group.assertion.regexp',
//                     'punctuation.definition.character-class.regexp',
//                     'punctuation.character.set.begin.regexp',
//                     'punctuation.character.set.end.regexp',
//                     'keyword.operator.negation.regexp',
//                     'support.other.parenthesis.regexp',
//                 ],
//                 'settings': {
//                     'foreground': '#d16969',
//                 },
//             },
//             {
//                 'scope': [
//                     'constant.character.character-class.regexp',
//                     'constant.other.character-class.set.regexp',
//                     'constant.other.character-class.regexp',
//                     'constant.character.set.regexp',
//                 ],
//                 'settings': {
//                     'foreground': '#811f3f',
//                 },
//             },
//             {
//                 'scope': 'keyword.operator.quantifier.regexp',
//                 'settings': {
//                     'foreground': '#000000',
//                 },
//             },
//             {
//                 'scope': [
//                     'keyword.operator.or.regexp',
//                     'keyword.control.anchor.regexp',
//                 ],
//                 'settings': {
//                     'foreground': '#EE0000',
//                 },
//             },
//             {
//                 'scope': 'constant.character',
//                 'settings': {
//                     'foreground': '#0000ff',
//                 },
//             },
//             {
//                 'scope': 'constant.character.escape',
//                 'settings': {
//                     'foreground': '#EE0000',
//                 },
//             },
//             {
//                 'scope': 'entity.name.label',
//                 'settings': {
//                     'foreground': '#000000',
//                 },
//             },
//         ],
//         'semanticHighlighting': true,
//         'semanticTokenColors': {
//             'newOperator': '#AF00DB',
//             'stringLiteral': '#a31515',
//             'customLiteral': '#795E26',
//             'numberLiteral': '#098658',
//         },
//     },
//     {
//         'id': 'dark-vs',
//         'name': 'Dark (Visual Studio)',
//         'base': 'vs-dark',
//         'colors': {
//             'editor.background': '#1E1E1E',
//             'editor.foreground': '#D4D4D4',
//             'editor.inactiveSelectionBackground': '#3A3D41',
//             'editorIndentGuide.background': '#404040',
//             'editorIndentGuide.activeBackground': '#707070',
//             'editor.selectionHighlightBackground': '#ADD6FF26',
//             'list.dropBackground': '#383B3D',
//             'activityBarBadge.background': '#007ACC',
//             'sideBarTitle.foreground': '#BBBBBB',
//             'input.placeholderForeground': '#A6A6A6',
//             'menu.background': '#252526',
//             'menu.foreground': '#CCCCCC',
//             'statusBarItem.remoteForeground': '#FFF',
//             'statusBarItem.remoteBackground': '#16825D',
//             'sideBarSectionHeader.background': '#0000',
//             'sideBarSectionHeader.border': '#ccc3',
//             'tab.lastPinnedBorder': '#ccc3',
//         },
//         'tokenColors': [
//             {
//                 'scope': [
//                     'meta.embedded',
//                     'source.groovy.embedded',
//                 ],
//                 'settings': {
//                     'foreground': '#D4D4D4',
//                 },
//             },
//             {
//                 'scope': 'emphasis',
//                 'settings': {
//                     'fontStyle': 'italic',
//                 },
//             },
//             {
//                 'scope': 'strong',
//                 'settings': {
//                     'fontStyle': 'bold',
//                 },
//             },
//             {
//                 'scope': 'header',
//                 'settings': {
//                     'foreground': '#000080',
//                 },
//             },
//             {
//                 'scope': 'comment',
//                 'settings': {
//                     'foreground': '#6A9955',
//                 },
//             },
//             {
//                 'scope': 'constant.language',
//                 'settings': {
//                     'foreground': '#569cd6',
//                 },
//             },
//             {
//                 'scope': [
//                     'constant.numeric',
//                     'variable.other.enummember',
//                     'keyword.operator.plus.exponent',
//                     'keyword.operator.minus.exponent',
//                 ],
//                 'settings': {
//                     'foreground': '#b5cea8',
//                 },
//             },
//             {
//                 'scope': 'constant.regexp',
//                 'settings': {
//                     'foreground': '#646695',
//                 },
//             },
//             {
//                 'scope': 'entity.name.tag',
//                 'settings': {
//                     'foreground': '#569cd6',
//                 },
//             },
//             {
//                 'scope': 'entity.name.tag.css',
//                 'settings': {
//                     'foreground': '#d7ba7d',
//                 },
//             },
//             {
//                 'scope': 'entity.other.attribute-name',
//                 'settings': {
//                     'foreground': '#9cdcfe',
//                 },
//             },
//             {
//                 'scope': [
//                     'entity.other.attribute-name.class.css',
//                     'entity.other.attribute-name.class.mixin.css',
//                     'entity.other.attribute-name.id.css',
//                     'entity.other.attribute-name.parent-selector.css',
//                     'entity.other.attribute-name.pseudo-class.css',
//                     'entity.other.attribute-name.pseudo-element.css',
//                     'source.css.less entity.other.attribute-name.id',
//                     'entity.other.attribute-name.scss',
//                 ],
//                 'settings': {
//                     'foreground': '#d7ba7d',
//                 },
//             },
//             {
//                 'scope': 'invalid',
//                 'settings': {
//                     'foreground': '#f44747',
//                 },
//             },
//             {
//                 'scope': 'markup.underline',
//                 'settings': {
//                     'fontStyle': 'underline',
//                 },
//             },
//             {
//                 'scope': 'markup.bold',
//                 'settings': {
//                     'fontStyle': 'bold',
//                     'foreground': '#569cd6',
//                 },
//             },
//             {
//                 'scope': 'markup.heading',
//                 'settings': {
//                     'fontStyle': 'bold',
//                     'foreground': '#569cd6',
//                 },
//             },
//             {
//                 'scope': 'markup.italic',
//                 'settings': {
//                     'fontStyle': 'italic',
//                 },
//             },
//             {
//                 'scope': 'markup.inserted',
//                 'settings': {
//                     'foreground': '#b5cea8',
//                 },
//             },
//             {
//                 'scope': 'markup.deleted',
//                 'settings': {
//                     'foreground': '#ce9178',
//                 },
//             },
//             {
//                 'scope': 'markup.changed',
//                 'settings': {
//                     'foreground': '#569cd6',
//                 },
//             },
//             {
//                 'scope': 'punctuation.definition.quote.begin.markdown',
//                 'settings': {
//                     'foreground': '#6A9955',
//                 },
//             },
//             {
//                 'scope': 'punctuation.definition.list.begin.markdown',
//                 'settings': {
//                     'foreground': '#6796e6',
//                 },
//             },
//             {
//                 'scope': 'markup.inline.raw',
//                 'settings': {
//                     'foreground': '#ce9178',
//                 },
//             },
//             {
//                 'name': 'brackets of XML/HTML tags',
//                 'scope': 'punctuation.definition.tag',
//                 'settings': {
//                     'foreground': '#808080',
//                 },
//             },
//             {
//                 'scope': [
//                     'meta.preprocessor',
//                     'entity.name.function.preprocessor',
//                 ],
//                 'settings': {
//                     'foreground': '#569cd6',
//                 },
//             },
//             {
//                 'scope': 'meta.preprocessor.string',
//                 'settings': {
//                     'foreground': '#ce9178',
//                 },
//             },
//             {
//                 'scope': 'meta.preprocessor.numeric',
//                 'settings': {
//                     'foreground': '#b5cea8',
//                 },
//             },
//             {
//                 'scope': 'meta.structure.dictionary.key.python',
//                 'settings': {
//                     'foreground': '#9cdcfe',
//                 },
//             },
//             {
//                 'scope': 'meta.diff.header',
//                 'settings': {
//                     'foreground': '#569cd6',
//                 },
//             },
//             {
//                 'scope': 'storage',
//                 'settings': {
//                     'foreground': '#569cd6',
//                 },
//             },
//             {
//                 'scope': 'storage.type',
//                 'settings': {
//                     'foreground': '#569cd6',
//                 },
//             },
//             {
//                 'scope': [
//                     'storage.modifier',
//                     'keyword.operator.noexcept',
//                 ],
//                 'settings': {
//                     'foreground': '#569cd6',
//                 },
//             },
//             {
//                 'scope': [
//                     'string',
//                     'meta.embedded.assembly',
//                 ],
//                 'settings': {
//                     'foreground': '#ce9178',
//                 },
//             },
//             {
//                 'scope': 'string.tag',
//                 'settings': {
//                     'foreground': '#ce9178',
//                 },
//             },
//             {
//                 'scope': 'string.value',
//                 'settings': {
//                     'foreground': '#ce9178',
//                 },
//             },
//             {
//                 'scope': 'string.regexp',
//                 'settings': {
//                     'foreground': '#d16969',
//                 },
//             },
//             {
//                 'name': 'String interpolation',
//                 'scope': [
//                     'punctuation.definition.template-expression.begin',
//                     'punctuation.definition.template-expression.end',
//                     'punctuation.section.embedded',
//                 ],
//                 'settings': {
//                     'foreground': '#569cd6',
//                 },
//             },
//             {
//                 'name': 'Reset JavaScript string interpolation expression',
//                 'scope': [
//                     'meta.template.expression',
//                 ],
//                 'settings': {
//                     'foreground': '#d4d4d4',
//                 },
//             },
//             {
//                 'scope': [
//                     'support.type.vendored.property-name',
//                     'support.type.property-name',
//                     'variable.css',
//                     'variable.scss',
//                     'variable.other.less',
//                     'source.coffee.embedded',
//                 ],
//                 'settings': {
//                     'foreground': '#9cdcfe',
//                 },
//             },
//             {
//                 'scope': 'keyword',
//                 'settings': {
//                     'foreground': '#569cd6',
//                 },
//             },
//             {
//                 'scope': 'keyword.control',
//                 'settings': {
//                     'foreground': '#569cd6',
//                 },
//             },
//             {
//                 'scope': 'keyword.operator',
//                 'settings': {
//                     'foreground': '#d4d4d4',
//                 },
//             },
//             {
//                 'scope': [
//                     'keyword.operator.new',
//                     'keyword.operator.expression',
//                     'keyword.operator.cast',
//                     'keyword.operator.sizeof',
//                     'keyword.operator.alignof',
//                     'keyword.operator.typeid',
//                     'keyword.operator.alignas',
//                     'keyword.operator.instanceof',
//                     'keyword.operator.logical.python',
//                     'keyword.operator.wordlike',
//                 ],
//                 'settings': {
//                     'foreground': '#569cd6',
//                 },
//             },
//             {
//                 'scope': 'keyword.other.unit',
//                 'settings': {
//                     'foreground': '#b5cea8',
//                 },
//             },
//             {
//                 'scope': [
//                     'punctuation.section.embedded.begin.php',
//                     'punctuation.section.embedded.end.php',
//                 ],
//                 'settings': {
//                     'foreground': '#569cd6',
//                 },
//             },
//             {
//                 'scope': 'support.function.git-rebase',
//                 'settings': {
//                     'foreground': '#9cdcfe',
//                 },
//             },
//             {
//                 'scope': 'constant.sha.git-rebase',
//                 'settings': {
//                     'foreground': '#b5cea8',
//                 },
//             },
//             {
//                 'name': 'coloring of the Java import and package identifiers',
//                 'scope': [
//                     'storage.modifier.import.java',
//                     'variable.language.wildcard.java',
//                     'storage.modifier.package.java',
//                 ],
//                 'settings': {
//                     'foreground': '#d4d4d4',
//                 },
//             },
//             {
//                 'name': 'this.self',
//                 'scope': 'variable.language',
//                 'settings': {
//                     'foreground': '#569cd6',
//                 },
//             },
//         ],
//         'semanticHighlighting': true,
//         'semanticTokenColors': {
//             'newOperator': '#d4d4d4',
//             'stringLiteral': '#ce9178',
//             'customLiteral': '#D4D4D4',
//             'numberLiteral': '#b5cea8',
//         },
//     },
//     {
//         'id': 'light-vs',
//         'name': 'Light (Visual Studio)',
//         'base': 'vs',
//         'colors': {
//             'editor.background': '#FFFFFF',
//             'editor.foreground': '#000000',
//             'editor.inactiveSelectionBackground': '#E5EBF1',
//             'editorIndentGuide.background': '#D3D3D3',
//             'editorIndentGuide.activeBackground': '#939393',
//             'editor.selectionHighlightBackground': '#ADD6FF80',
//             'editorSuggestWidget.background': '#F3F3F3',
//             'activityBarBadge.background': '#007ACC',
//             'sideBarTitle.foreground': '#6F6F6F',
//             'list.hoverBackground': '#E8E8E8',
//             'input.placeholderForeground': '#767676',
//             'searchEditor.textInputBorder': '#CECECE',
//             'settings.textInputBorder': '#CECECE',
//             'settings.numberInputBorder': '#CECECE',
//             'statusBarItem.remoteForeground': '#FFF',
//             'statusBarItem.remoteBackground': '#16825D',
//             'sideBarSectionHeader.background': '#0000',
//             'sideBarSectionHeader.border': '#61616130',
//             'tab.lastPinnedBorder': '#61616130',
//             'notebook.cellBorderColor': '#E8E8E8',
//             'statusBarItem.errorBackground': '#c72e0f',
//         },
//         'tokenColors': [
//             {
//                 'scope': [
//                     'meta.embedded',
//                     'source.groovy.embedded',
//                 ],
//                 'settings': {
//                     'foreground': '#000000ff',
//                 },
//             },
//             {
//                 'scope': 'emphasis',
//                 'settings': {
//                     'fontStyle': 'italic',
//                 },
//             },
//             {
//                 'scope': 'strong',
//                 'settings': {
//                     'fontStyle': 'bold',
//                 },
//             },
//             {
//                 'scope': 'meta.diff.header',
//                 'settings': {
//                     'foreground': '#000080',
//                 },
//             },
//             {
//                 'scope': 'comment',
//                 'settings': {
//                     'foreground': '#008000',
//                 },
//             },
//             {
//                 'scope': 'constant.language',
//                 'settings': {
//                     'foreground': '#0000ff',
//                 },
//             },
//             {
//                 'scope': [
//                     'constant.numeric',
//                     'variable.other.enummember',
//                     'keyword.operator.plus.exponent',
//                     'keyword.operator.minus.exponent',
//                 ],
//                 'settings': {
//                     'foreground': '#098658',
//                 },
//             },
//             {
//                 'scope': 'constant.regexp',
//                 'settings': {
//                     'foreground': '#811f3f',
//                 },
//             },
//             {
//                 'name': 'css tags in selectors, xml tags',
//                 'scope': 'entity.name.tag',
//                 'settings': {
//                     'foreground': '#800000',
//                 },
//             },
//             {
//                 'scope': 'entity.name.selector',
//                 'settings': {
//                     'foreground': '#800000',
//                 },
//             },
//             {
//                 'scope': 'entity.other.attribute-name',
//                 'settings': {
//                     'foreground': '#ff0000',
//                 },
//             },
//             {
//                 'scope': [
//                     'entity.other.attribute-name.class.css',
//                     'entity.other.attribute-name.class.mixin.css',
//                     'entity.other.attribute-name.id.css',
//                     'entity.other.attribute-name.parent-selector.css',
//                     'entity.other.attribute-name.pseudo-class.css',
//                     'entity.other.attribute-name.pseudo-element.css',
//                     'source.css.less entity.other.attribute-name.id',
//                     'entity.other.attribute-name.scss',
//                 ],
//                 'settings': {
//                     'foreground': '#800000',
//                 },
//             },
//             {
//                 'scope': 'invalid',
//                 'settings': {
//                     'foreground': '#cd3131',
//                 },
//             },
//             {
//                 'scope': 'markup.underline',
//                 'settings': {
//                     'fontStyle': 'underline',
//                 },
//             },
//             {
//                 'scope': 'markup.bold',
//                 'settings': {
//                     'fontStyle': 'bold',
//                     'foreground': '#000080',
//                 },
//             },
//             {
//                 'scope': 'markup.heading',
//                 'settings': {
//                     'fontStyle': 'bold',
//                     'foreground': '#800000',
//                 },
//             },
//             {
//                 'scope': 'markup.italic',
//                 'settings': {
//                     'fontStyle': 'italic',
//                 },
//             },
//             {
//                 'scope': 'markup.inserted',
//                 'settings': {
//                     'foreground': '#098658',
//                 },
//             },
//             {
//                 'scope': 'markup.deleted',
//                 'settings': {
//                     'foreground': '#a31515',
//                 },
//             },
//             {
//                 'scope': 'markup.changed',
//                 'settings': {
//                     'foreground': '#0451a5',
//                 },
//             },
//             {
//                 'scope': [
//                     'punctuation.definition.quote.begin.markdown',
//                     'punctuation.definition.list.begin.markdown',
//                 ],
//                 'settings': {
//                     'foreground': '#0451a5',
//                 },
//             },
//             {
//                 'scope': 'markup.inline.raw',
//                 'settings': {
//                     'foreground': '#800000',
//                 },
//             },
//             {
//                 'name': 'brackets of XML/HTML tags',
//                 'scope': 'punctuation.definition.tag',
//                 'settings': {
//                     'foreground': '#800000',
//                 },
//             },
//             {
//                 'scope': [
//                     'meta.preprocessor',
//                     'entity.name.function.preprocessor',
//                 ],
//                 'settings': {
//                     'foreground': '#0000ff',
//                 },
//             },
//             {
//                 'scope': 'meta.preprocessor.string',
//                 'settings': {
//                     'foreground': '#a31515',
//                 },
//             },
//             {
//                 'scope': 'meta.preprocessor.numeric',
//                 'settings': {
//                     'foreground': '#098658',
//                 },
//             },
//             {
//                 'scope': 'meta.structure.dictionary.key.python',
//                 'settings': {
//                     'foreground': '#0451a5',
//                 },
//             },
//             {
//                 'scope': 'storage',
//                 'settings': {
//                     'foreground': '#0000ff',
//                 },
//             },
//             {
//                 'scope': 'storage.type',
//                 'settings': {
//                     'foreground': '#0000ff',
//                 },
//             },
//             {
//                 'scope': [
//                     'storage.modifier',
//                     'keyword.operator.noexcept',
//                 ],
//                 'settings': {
//                     'foreground': '#0000ff',
//                 },
//             },
//             {
//                 'scope': [
//                     'string',
//                     'meta.embedded.assembly',
//                 ],
//                 'settings': {
//                     'foreground': '#a31515',
//                 },
//             },
//             {
//                 'scope': [
//                     'string.comment.buffered.block.pug',
//                     'string.quoted.pug',
//                     'string.interpolated.pug',
//                     'string.unquoted.plain.in.yaml',
//                     'string.unquoted.plain.out.yaml',
//                     'string.unquoted.block.yaml',
//                     'string.quoted.single.yaml',
//                     'string.quoted.double.xml',
//                     'string.quoted.single.xml',
//                     'string.unquoted.cdata.xml',
//                     'string.quoted.double.html',
//                     'string.quoted.single.html',
//                     'string.unquoted.html',
//                     'string.quoted.single.handlebars',
//                     'string.quoted.double.handlebars',
//                 ],
//                 'settings': {
//                     'foreground': '#0000ff',
//                 },
//             },
//             {
//                 'scope': 'string.regexp',
//                 'settings': {
//                     'foreground': '#811f3f',
//                 },
//             },
//             {
//                 'name': 'String interpolation',
//                 'scope': [
//                     'punctuation.definition.template-expression.begin',
//                     'punctuation.definition.template-expression.end',
//                     'punctuation.section.embedded',
//                 ],
//                 'settings': {
//                     'foreground': '#0000ff',
//                 },
//             },
//             {
//                 'name': 'Reset JavaScript string interpolation expression',
//                 'scope': [
//                     'meta.template.expression',
//                 ],
//                 'settings': {
//                     'foreground': '#000000',
//                 },
//             },
//             {
//                 'scope': [
//                     'support.constant.property-value',
//                     'support.constant.font-name',
//                     'support.constant.media-type',
//                     'support.constant.media',
//                     'constant.other.color.rgb-value',
//                     'constant.other.rgb-value',
//                     'support.constant.color',
//                 ],
//                 'settings': {
//                     'foreground': '#0451a5',
//                 },
//             },
//             {
//                 'scope': [
//                     'support.type.vendored.property-name',
//                     'support.type.property-name',
//                     'variable.css',
//                     'variable.scss',
//                     'variable.other.less',
//                     'source.coffee.embedded',
//                 ],
//                 'settings': {
//                     'foreground': '#ff0000',
//                 },
//             },
//             {
//                 'scope': [
//                     'support.type.property-name.json',
//                 ],
//                 'settings': {
//                     'foreground': '#0451a5',
//                 },
//             },
//             {
//                 'scope': 'keyword',
//                 'settings': {
//                     'foreground': '#0000ff',
//                 },
//             },
//             {
//                 'scope': 'keyword.control',
//                 'settings': {
//                     'foreground': '#0000ff',
//                 },
//             },
//             {
//                 'scope': 'keyword.operator',
//                 'settings': {
//                     'foreground': '#000000',
//                 },
//             },
//             {
//                 'scope': [
//                     'keyword.operator.new',
//                     'keyword.operator.expression',
//                     'keyword.operator.cast',
//                     'keyword.operator.sizeof',
//                     'keyword.operator.alignof',
//                     'keyword.operator.typeid',
//                     'keyword.operator.alignas',
//                     'keyword.operator.instanceof',
//                     'keyword.operator.logical.python',
//                     'keyword.operator.wordlike',
//                 ],
//                 'settings': {
//                     'foreground': '#0000ff',
//                 },
//             },
//             {
//                 'scope': 'keyword.other.unit',
//                 'settings': {
//                     'foreground': '#098658',
//                 },
//             },
//             {
//                 'scope': [
//                     'punctuation.section.embedded.begin.php',
//                     'punctuation.section.embedded.end.php',
//                 ],
//                 'settings': {
//                     'foreground': '#800000',
//                 },
//             },
//             {
//                 'scope': 'support.function.git-rebase',
//                 'settings': {
//                     'foreground': '#0451a5',
//                 },
//             },
//             {
//                 'scope': 'constant.sha.git-rebase',
//                 'settings': {
//                     'foreground': '#098658',
//                 },
//             },
//             {
//                 'name': 'coloring of the Java import and package identifiers',
//                 'scope': [
//                     'storage.modifier.import.java',
//                     'variable.language.wildcard.java',
//                     'storage.modifier.package.java',
//                 ],
//                 'settings': {
//                     'foreground': '#000000',
//                 },
//             },
//             {
//                 'name': 'this.self',
//                 'scope': 'variable.language',
//                 'settings': {
//                     'foreground': '#0000ff',
//                 },
//             },
//         ],
//         'semanticHighlighting': true,
//         'semanticTokenColors': {
//             'newOperator': '#0000ff',
//             'stringLiteral': '#a31515',
//             'customLiteral': '#000000',
//             'numberLiteral': '#098658',
//         },
//     },
// ]
//
// window.fetchTheme1 = (e) => {
//     const t = monacoThemes.find(e1=>e1.id === e) || monacoThemes[0],
//         n = {
//             id: e,
//             colors: t.colors,
//             base: t.base,
//             settings: [...t.colors ? [{
//                 settings: {
//                     foreground: t.colors['editor.foreground'],
//                     background: t.colors['editor.background'],
//                 },
//             }] : [], ...t.tokenColors],
//         };
//     if (t.inherit) {
//         const e = fetchTheme1(t.inherit);
//         n.base = e.base,
//         n.settings = [...e.settings || [], ...n.settings],
//         n.colors = {
//             ...e.colors,
//             ...n.colors,
//         }
//     }
//     return n
// }
//
// /**
//  * Taken from ACE editor
//  */
// function rgbColor (color) {
//     if (typeof color == 'object')
//         return color;
//     if (color[0] == '#')
//         return color.match(/^#(..)(..)(..)/).slice(1).map(function (c) {
//             return parseInt(c, 16);
//         });
//     else
//         return color.match(/\(([^,]+),([^,]+),([^,]+)/).slice(1).map(function (c) {
//             return parseInt(c, 10);
//         });
// }
// function darkness (color) {
//     const rgb = rgbColor(color);
//     return (0.21 * rgb[0] + 0.72 * rgb[1] + 0.07 * rgb[2]) / 255;
// }
//
// function parseColor (color) {
//     if (!color.length) return null;
//     if (color.length == 4)
//         color = color.replace(/[a-fA-F\d]/g, '$&$&');
//     if (color.length == 7)
//         return color
//     if (color.length == 9)
//         return color; // substr(0, 7);
//     else {
//         if (!color.match(/^#(..)(..)(..)(..)$/))
//             console.error('can\'t parse color', color);
//         const rgba = color.match(/^#(..)(..)(..)(..)$/).slice(1).map(function (c) {
//             return parseInt(c, 16);
//         });
//         rgba[3] = (rgba[3] / 0xFF).toPrecision(2);
//         return 'rgba(' + rgba.join(', ') + ')';
//     }
// }
//
// /* Mapped from vscode/src/vs/workbench/services/themes/electron-browser/themeCompatibility.ts */
// const COLOR_MAP = [
//     {
//         tm: 'foreground',
//         mn: 'editor.foreground',
//     },
//     {
//         tm: 'background',
//         mn: 'editor.background',
//     },
//     // {
//     //   tm: 'foreground',
//     //   mn: 'editorSuggestWidget.foreground',
//     // },
//     // {
//     //   tm: 'background',
//     //   mn: 'editorSuggestWidget.background',
//     // },
//     {
//         tm: 'selection',
//         mn: 'editor.selectionBackground',
//     },
//     {
//         tm: 'inactiveSelection',
//         mn: 'editor.inactiveSelectionBackground',
//     },
//     {
//         tm: 'selectionHighlightColor',
//         mn: 'editor.selectionHighlightBackground',
//     },
//     {
//         tm: 'findMatchHighlight',
//         mn: 'editor.findMatchHighlightBackground',
//     },
//     {
//         tm: 'currentFindMatchHighlight',
//         mn: 'editor.findMatchBackground',
//     },
//     {
//         tm: 'hoverHighlight',
//         mn: 'editor.hoverHighlightBackground',
//     },
//     {
//         tm: 'wordHighlight',
//         mn: 'editor.wordHighlightBackground',
//     },
//     {
//         tm: 'wordHighlightStrong',
//         mn: 'editor.wordHighlightStrongBackground',
//     },
//     {
//         tm: 'findRangeHighlight',
//         mn: 'editor.findRangeHighlightBackground',
//     },
//     {
//         tm: 'findMatchHighlight',
//         mn: 'peekViewResult.matchHighlightBackground',
//     },
//     {
//         tm: 'referenceHighlight',
//         mn: 'peekViewEditor.matchHighlightBackground',
//     },
//     {
//         tm: 'lineHighlight',
//         mn: 'editor.lineHighlightBackground',
//     },
//     {
//         tm: 'rangeHighlight',
//         mn: 'editor.rangeHighlightBackground',
//     },
//     {
//         tm: 'caret',
//         mn: 'editorCursor.foreground',
//     },
//     {
//         tm: 'invisibles',
//         mn: 'editorWhitespace.foreground',
//     },
//     {
//         tm: 'guide',
//         mn: 'editorIndentGuide.background',
//     },
//     {
//         tm: 'activeGuide',
//         mn: 'editorIndentGuide.activeBackground',
//     },
//     {
//         tm: 'selectionBorder',
//         mn: 'editor.selectionHighlightBorder',
//     },
// ];
//
// const ansiColorMap = ['ansiBlack', 'ansiRed', 'ansiGreen', 'ansiYellow', 'ansiBlue', 'ansiMagenta', 'ansiCyan', 'ansiWhite',
//     'ansiBrightBlack', 'ansiBrightRed', 'ansiBrightGreen', 'ansiBrightYellow', 'ansiBrightBlue', 'ansiBrightMagenta', 'ansiBrightCyan', 'ansiBrightWhite',
// ];
//
// ansiColorMap.forEach((color) => {
//     COLOR_MAP.push({
//         tm: color,
//         mn: 'terminal.' + color,
//     });
// });
//
// const GUTTER_COLOR_MAP = [];
//
// /**
//  * @param {string} rawTmThemeString - The contents read from a tmTheme file.
//  * @returns {IStandaloneThemeData} A monaco compatible theme definition. See https://microsoft.github.io/monaco-editor/api/interfaces/monaco.editor.istandalonethemedata.html
//  */
// function convertTmTheme (rawData) {
//     const globalSettings = rawData.settings[0].settings;
//     const gutterSettings = rawData.gutterSettings;
//     const rules = [];
//
//     rawData.settings.forEach(setting => {
//         if (!setting.settings) {
//             return;
//         }
//
//         let scopes;
//
//         if (typeof setting.scope === 'string') {
//             scopes = setting.scope.replace(/^[,]+/, '').replace(/[,]+$/, '').split(',');
//         } else if (Array.isArray(setting.scope)) {
//             scopes = setting.scope;
//         } else {
//             scopes = [''];
//         }
//
//         const rule = {};
//         const settings = setting.settings;
//
//         if (settings.foreground) {
//             rule.foreground = parseColor(settings.foreground).toLowerCase().replace('#', '');
//         }
//
//         if (settings.background) {
//             rule.background = parseColor(settings.background).toLowerCase().replace('#', '');
//         }
//
//         if (settings.fontStyle && typeof settings.fontStyle === 'string') {
//             rule.fontStyle = settings.fontStyle;
//         }
//
//         scopes.forEach(scope => {
//             if (!scope || !Object.keys(rule).length) {
//                 return;
//             }
//             const r = Object.assign({}, rule, {
//                 token: scope.trim(),
//             });
//             rules.push(r);
//         });
//     });
//
//     const globalColors = {};
//
//     /* More properties to be added */
//     COLOR_MAP.forEach((obj) => {
//         if (globalSettings[obj.tm]) {
//             globalColors[obj.mn] = parseColor(globalSettings[obj.tm]);
//         }
//     });
//
//     if (gutterSettings) {
//         GUTTER_COLOR_MAP.forEach((obj) => {
//             if (gutterSettings[obj.tm]) {
//                 globalColors[obj.mn] = parseColor(gutterSettings[obj.tm]);
//             }
//         });
//     }
//
//     return {
//         base: (darkness(globalColors['editor.background']) < 0.5) ? 'vs-dark' : 'vs',
//         inherit: true,
//         rules: rules,
//         colors: globalColors,
//     };
// }
//
//
// window.fetchTheme = (e) => {
//     const tmTheme = fetchTheme1(e)
//     return convertTmTheme(tmTheme);
// }

// todo textmate grammars - https://github.com/zikaari/monaco-editor-textmate
// import * as onigasm from 'https://unpkg.com/onigasm@2.2.5/lib/index.js' // peer dependency of 'monaco-textmate'
// import * as MTM from 'https://unpkg.com/monaco-textmate@3.0.1/dist/main.js' // peer dependency
// import * as TMG from 'https://unpkg.com/monaco-editor-textmate@4.0.0/dist/index.js'
// console.log(MTM)
// window.setupTM = async (monaco, editor) => {
//     await onigasm.loadWASM('https://unpkg.com/onigasm@2.2.5/lib/onigasm.wasm') // See https://www.npmjs.com/package/onigasm#light-it-up
//
//     const registry = new Registry({
//         getGrammarDefinition: async (scopeName) => {
//             return {
//                 format: 'json',
//                 content: await (await fetch('static/grammars/css.tmGrammar.json')).text(),
//             }
//         },
//     })
//
//     // map of monaco "language id's" to TextMate scopeNames
//     const grammars = new Map()
//     grammars.set('css', 'source.css')
//     grammars.set('html', 'text.html.basic')
//     grammars.set('typescript', 'source.ts')
//     grammars.set('javascript', 'source.js')
//
//     await wireTmGrammars(monaco, registry, grammars, editor)
// }

