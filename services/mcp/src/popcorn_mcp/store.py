"""Key-value document storage: DynamoDB in the cloud, a dict in tests.

Documents are stored as JSON strings, so floats need no Decimal handling.
Table schema: partition key "pk" (string), TTL attribute "expires_at".
"""

import asyncio
import json
import time
from typing import Protocol

import boto3
from botocore.config import Config


class Store(Protocol):
    async def get(self, key: str) -> dict | None: ...

    async def put(self, key: str, doc: dict, ttl_seconds: int | None = None) -> None: ...

    async def delete(self, key: str) -> None: ...


class MemoryStore:
    def __init__(self) -> None:
        self._items: dict[str, tuple[str, float | None]] = {}

    async def get(self, key: str) -> dict | None:
        item = self._items.get(key)
        if item is None:
            return None
        raw, expires_at = item
        if expires_at is not None and expires_at < time.time():
            return None
        return json.loads(raw)

    async def put(self, key: str, doc: dict, ttl_seconds: int | None = None) -> None:
        expires_at = time.time() + ttl_seconds if ttl_seconds else None
        self._items[key] = (json.dumps(doc), expires_at)

    async def delete(self, key: str) -> None:
        self._items.pop(key, None)


class DynamoStore:
    def __init__(self, table_name: str, region: str) -> None:
        config = Config(retries={"total_max_attempts": 3, "mode": "standard"}, connect_timeout=3, read_timeout=5)
        self._table = boto3.resource("dynamodb", region_name=region, config=config).Table(table_name)

    async def get(self, key: str) -> dict | None:
        response = await asyncio.to_thread(self._table.get_item, Key={"pk": key})
        item = response.get("Item")
        if item is None:
            return None
        # DynamoDB deletes expired items lazily, so check the TTL here too.
        if "expires_at" in item and int(item["expires_at"]) < time.time():
            return None
        return json.loads(item["doc"])

    async def put(self, key: str, doc: dict, ttl_seconds: int | None = None) -> None:
        item = {"pk": key, "doc": json.dumps(doc, ensure_ascii=False)}
        if ttl_seconds:
            item["expires_at"] = int(time.time()) + ttl_seconds
        await asyncio.to_thread(self._table.put_item, Item=item)

    async def delete(self, key: str) -> None:
        await asyncio.to_thread(self._table.delete_item, Key={"pk": key})
