import { OptionalDeclaration, ScopedDeclaration, StaticDeclaration, TypedDeclaration } from './Declaration';
import { DeclarationVisibility } from './DeclarationVisibility';
import { ParameterDeclaration } from './ParameterDeclaration';
/**
 * Property declaration that contains its visibility.
 *
 * @export
 * @class PropertyDeclaration
 * @implements {ScopedDeclaration}
 * @implements {TypedDeclaration}
 */
export declare class PropertyDeclaration implements OptionalDeclaration, ScopedDeclaration, StaticDeclaration, TypedDeclaration {
    name: string;
    visibility: DeclarationVisibility | undefined;
    type: string | undefined;
    isOptional: boolean;
    isStatic: boolean;
    start?: number | undefined;
    end?: number | undefined;
    typeArguments: ParameterDeclaration[];
    constructor(name: string, visibility: DeclarationVisibility | undefined, type: string | undefined, isOptional: boolean, isStatic: boolean, start?: number | undefined, end?: number | undefined);
}
