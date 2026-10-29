'use client';

import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { gerarLista, listarListas } from "@/lib/erp-api";
import { useMe } from "@/lib/auth";
import { PageHeader, Panel, Tag, Empty, STATUS_LISTA } from "@/components/ui-kit";
import { Button } from "@/components/ui/button";
import { dataBR, MESES } from "@/lib/format";
import { errMsg } from "@/lib/db";


export default function Compras() {
  const { data: me } = useMe();
  const router = useRouter();
  const { data } = useQuery({ queryKey: ["listas"], queryFn: listarListas });
  async function gerar() {
    try {
      const { id } = await gerarLista();
      router.push(`/compras/${id}`);
    } catch (error) {
      toast.error(errMsg(error));
    }
  }
  return (
    <div className="space-y-4">
      <PageHeader title="Lista de Compras" sub="Pedido = objetivo do mês − estoque contado" actions={me?.perfil === "admin" && <Button onClick={gerar}>Gerar lista agora</Button>} />
      {!data?.length ? <Empty>Nenhuma lista ainda. Ela é gerada ao fechar o inventário.</Empty> : (
        <Panel>
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-muted-foreground"><tr><th className="py-2 text-left">Data</th><th className="text-left">Mês de referência</th><th className="text-right">Status</th></tr></thead>
            <tbody>{data.map((l) => (
              <tr key={l.id} className="cursor-pointer border-t hover:bg-muted/40" onClick={() => router.push(`/compras/${l.id}`)}>

                <td className="py-2">{dataBR(l.data)}</td><td>{MESES[l.mes - 1]}</td><td className="text-right"><Tag tone={STATUS_LISTA[l.status].tone}>{STATUS_LISTA[l.status].label}</Tag></td>
              </tr>
            ))}</tbody>
          </table>
        </Panel>
      )}
    </div>
  );
}
