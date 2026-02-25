export function toHex(num: number): string {
  return '0x' + num.toString(16).toUpperCase().padStart(4, '0');
}

export function parseInputList(value: string): number[] {
  return value
    .split(',')
    .map((x) => parseInt(x.trim(), 10))
    .filter((x) => !isNaN(x));
}
