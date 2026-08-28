import type { TableArtifact as Table } from "../../../lib/conversation/types";
import { DataTable, Td, Th } from "../../ui/DataTable";
import { ArtifactCard } from "./ArtifactCard";

export function TableArtifact({ artifact }: { artifact: Table }) {
  return (
    <ArtifactCard title={artifact.title} note={artifact.note}>
      <div className="overflow-x-auto px-4">
        <DataTable
          caption={artifact.title}
          head={
            <>
              {artifact.columns.map((c) => (
                <Th key={c.key} numeric={c.align === "right"}>{c.label}</Th>
              ))}
            </>
          }
        >
          {artifact.rows.map((row, i) => (
            <tr key={i}>
              {artifact.columns.map((c) => (
                <Td key={c.key} numeric={c.align === "right"} muted={row[c.key] == null}>
                  {row[c.key] == null ? "—" : String(row[c.key])}
                </Td>
              ))}
            </tr>
          ))}
        </DataTable>
      </div>
    </ArtifactCard>
  );
}
