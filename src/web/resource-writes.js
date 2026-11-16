const pending = new Map();

export function writeResources(keys, write) {
  const operation = Promise.all(keys.map((key) => pending.get(key))).then(
    write,
  );
  const settled = operation.then(
    () => {},
    () => {},
  );
  for (const key of keys) pending.set(key, settled);
  void settled.then(() => {
    for (const key of keys)
      if (pending.get(key) === settled) pending.delete(key);
  });
  return operation;
}
