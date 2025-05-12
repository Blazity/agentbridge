import { XMLBuilder } from "fast-xml-parser";

export function objectToXML(obj: Record<string, unknown>): string {
  const builder = new XMLBuilder({
    format: true,
    indentBy: "  ",
    ignoreAttributes: false,
    suppressEmptyNode: true,
    suppressBooleanAttributes: false,
  });

  return builder.build(obj);
}
