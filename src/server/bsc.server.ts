import { unitsFromWei } from "@/lib/wallet";

import { env } from "./env.server";

/** BSC (BEP20) üzerindeki USDT sözleşmesi; 18 ondalık. */
export const USDT_BEP20_CONTRACT = "0x55d398326f99059ff775485246999027b3197955";
/** keccak256("Transfer(address,address,uint256)") */
export const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
export const DEFAULT_BSC_RPC = "https://bsc-dataseed.bnbchain.org";
export const DEFAULT_CONFIRMATIONS = 12;

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
export const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;

export const isAddress = (v: string) => ADDRESS_RE.test(v);

interface RpcLog {
  address: string;
  topics: string[];
  data: string;
}

interface RpcReceipt {
  status: string;
  blockNumber: string;
  logs: RpcLog[];
}

/** Zincire erişim; testlerde sahte uygulama verilir. */
export interface BscClient {
  receipt(hash: string): Promise<RpcReceipt | null>;
  blockNumber(): Promise<number>;
  /** Bloğun zamanı (saniye). */
  blockTime(block: number): Promise<number>;
}

export function rpcClient(url: string, fetchImpl: typeof fetch = fetch): BscClient {
  let id = 0;
  async function call<T>(method: string, params: unknown[]): Promise<T> {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
    });
    if (!res.ok) throw new Error(`BSC RPC ${method} başarısız (${res.status})`);
    const body = (await res.json()) as { result?: T; error?: { message?: string } };
    if (body.error) throw new Error(`BSC RPC ${method}: ${body.error.message ?? "hata"}`);
    return body.result as T;
  }
  return {
    receipt: (hash) => call<RpcReceipt | null>("eth_getTransactionReceipt", [hash]),
    blockNumber: async () => Number(BigInt(await call<string>("eth_blockNumber", []))),
    blockTime: async (block) => {
      const b = await call<{ timestamp: string } | null>("eth_getBlockByNumber", [
        `0x${block.toString(16)}`,
        false,
      ]);
      if (!b) throw new Error("Blok bulunamadı");
      return Number(BigInt(b.timestamp));
    },
  };
}

export type TransferCheck =
  | { ok: true; amount: string; blockTime: number }
  | { ok: false; error: "notFound" | "failed" | "noTransfer" | "unconfirmed" | "oddAmount" };

const topicAddress = (topic: string | undefined) =>
  topic ? `0x${topic.slice(-40)}`.toLowerCase() : "";

/**
 * İşlemin, USDT sözleşmesi üzerinden alıcı adresine yapılmış başarılı bir
 * transfer olduğunu ve yeterince onaylandığını doğrular. Aynı işlemde birden
 * fazla transfer varsa alıcıya gidenler toplanır.
 */
export async function checkUsdtTransfer(
  client: BscClient,
  hash: string,
  receiver: string,
  confirmations: number,
): Promise<TransferCheck> {
  const receipt = await client.receipt(hash);
  if (!receipt) return { ok: false, error: "notFound" };
  if (receipt.status !== "0x1") return { ok: false, error: "failed" };

  const to = receiver.toLowerCase();
  const value = receipt.logs
    .filter(
      (l) =>
        l.address.toLowerCase() === USDT_BEP20_CONTRACT &&
        l.topics[0]?.toLowerCase() === TRANSFER_TOPIC &&
        topicAddress(l.topics[2]) === to,
    )
    .reduce((sum, l) => sum + BigInt(l.data), 0n);
  if (value === 0n) return { ok: false, error: "noTransfer" };

  const block = Number(BigInt(receipt.blockNumber));
  if ((await client.blockNumber()) - block < confirmations)
    return { ok: false, error: "unconfirmed" };

  const amount = unitsFromWei(value);
  if (!amount) return { ok: false, error: "oddAmount" };
  return { ok: true, amount, blockTime: await client.blockTime(block) };
}

export interface UsdtConfig {
  address: string;
  rpcUrl: string;
  confirmations: number;
}

/** USDT_BEP20_ADDRESS geçerli bir adres değilse yöntem kapalıdır. */
export function usdtConfig(): UsdtConfig | null {
  const address = env("USDT_BEP20_ADDRESS");
  if (!address || !isAddress(address)) return null;
  const confirmations = Number(env("USDT_BEP20_CONFIRMATIONS") ?? DEFAULT_CONFIRMATIONS);
  return {
    address,
    rpcUrl: env("BSC_RPC_URL") ?? DEFAULT_BSC_RPC,
    confirmations:
      Number.isInteger(confirmations) && confirmations >= 0 ? confirmations : DEFAULT_CONFIRMATIONS,
  };
}
