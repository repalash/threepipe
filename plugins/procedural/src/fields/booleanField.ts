/** `fn::invert_boolean_field` (`functions/intern/field.cc:560`): the registered "!bool" function. */

import {elementwise, FieldOperation, GField} from './field'

const notFn = elementwise('!bool', ['bool'], ['bool'], ([a], [o]) => { o[0] = a[0] ? 0 : 1 })

export function invertBooleanField(field: GField): GField {
    return new FieldOperation(notFn, [field]).output(0)
}
