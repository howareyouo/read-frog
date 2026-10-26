/**
 * TanStack Form `onChange` validator rejecting a name already taken by another
 * entity in the list. The `currentEntityId` exemption lets an entity keep its
 * own name while editing.
 */
export function createDuplicateNameValidator({
  entities,
  currentEntityId,
  message,
}: {
  entities: readonly { id: string; name: string }[]
  currentEntityId: string | undefined
  message: (name: string) => string
}) {
  return ({ value }: { value: string }) => {
    const duplicate = entities.find(
      (entity) => entity.name === value && entity.id !== currentEntityId,
    )
    return duplicate ? message(value) : undefined
  }
}
