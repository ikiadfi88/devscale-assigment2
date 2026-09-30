import "dotenv/config";
import postgres from "@prisma/orm-postgres/runtime";
import type { Contract } from "../generated/prisma/contract";
import contractJson from "../generated/prisma/contract.json" with { type: "json" };

export const db = postgres<Contract>({
  contractJson,
  url: process.env["DATABASE_URL"]!,
});
