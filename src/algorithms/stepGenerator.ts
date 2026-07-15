/**
 * RowKey 设计与热点 — 步骤生成器
 *
 * 动画展示 RowKey 设计对数据分布的影响：
 * 顺序 RowKey（自增 id）会把写入集中到最后一个 Region 形成热点；
 * 加盐 (salting)、哈希 (hash)、反转 (reverse) 可分散写入。
 */
import type { Step, VisualElement, VariableState } from '../types'

/** RowKey 设计伪代码 */
export const TEMPLATE_CODE = `// RowKey 设计：避免热点
byte[] rawKey = Bytes.toBytes("user123");

// 1. 顺序 RowKey（自增 id）→ 写入集中到末尾 Region，形成热点
byte[] seqKey = Bytes.toBytes(String.valueOf(id)); // id 自增

// 2. 加盐 salting：前缀 = hash % regionCount
int regionCount = 4;
int prefix = (rawKey.hashCode() & Integer.MAX_VALUE) % regionCount;
byte[] saltedKey = Bytes.toBytes(prefix + "_" + "user123");

// 3. 哈希 hash：整键取哈希，打散分布
byte[] hashedKey = MD5Hash(rawKey); // 取前缀做分区键

// 4. 反转 reverse：把高位变低位，把热点前缀打散
byte[] reversedKey = reverse(rawKey); // "321resu"

// 5. 写入：分区键决定落到哪个 Region
Put put = new Put(saltedKey);
table.put(put);`

// 画布布局常量：4 个 Region 横向排列，按 RowKey 范围分区
const REGION_COUNT = 4
const REGION_W = 200
const REGION_H = 90
const REGION_GAP = 12
const REGION_Y = 180
const REGION_START_X = 30

function regionX(i: number): number {
  return REGION_START_X + i * (REGION_W + REGION_GAP)
}

/** Region 区间（左闭右开，按字典序） */
const REGION_RANGES = [
  '[0x00, 0x40)',
  '[0x40, 0x80)',
  '[0x80, 0xC0)',
  '[0xC0, 0xFF)',
]

/** 构造 Region 元素 */
function makeRegions(highlightIdx?: number): VisualElement[] {
  return Array.from({ length: REGION_COUNT }, (_, i) => ({
    id: `region-${i}`,
    type: 'region',
    label: `Region ${i}`,
    subLabel: REGION_RANGES[i],
    x: regionX(i),
    y: REGION_Y,
    width: REGION_W,
    height: REGION_H,
    state: i === highlightIdx ? 'active' : 'idle',
  }))
}

/** 在指定 Region 内画一个 key 节点（hot 表示热点） */
function keyNode(
  regionIdx: number,
  slot: number,
  label: string,
  hot = false
): VisualElement {
  return {
    id: `key-${regionIdx}-${slot}`,
    type: 'key',
    label,
    x: regionX(regionIdx) + 20 + (slot % 3) * 55,
    y: REGION_Y + 95 + Math.floor(slot / 3) * 26,
    width: 50,
    height: 22,
    state: hot ? 'hot' : 'writing',
  }
}

export function generateSteps(): Step[] {
  const steps: Step[] = []
  let idx = 0

  const push = (
    desc: string,
    line: number,
    vars: VariableState[],
    elements: VisualElement[],
    arrows: { from: string; to: string; label?: string }[] = [],
    actionLabel?: string,
    statusText?: string
  ) => {
    steps.push({
      index: idx++,
      description: desc,
      currentLine: line,
      variables: vars,
      elements,
      connections: arrows.map((a, i) => ({
        id: `arrow-${i}`,
        fromId: a.from,
        toId: a.to,
        kind: 'arrow' as const,
        label: a.label,
      })),
      annotations: [],
      actionLabel,
      statusText: statusText ?? desc,
    })
  }

  const client = {
    id: 'client',
    type: 'client',
    label: 'Client',
    x: 430,
    y: 40,
    width: 130,
    height: 50,
    state: 'idle' as string,
  }

  // 步骤 0：Region 分布总览
  push(
    '表按 RowKey 范围预分区为 4 个 Region，写入落到哪个 Region 取决于 RowKey',
    2,
    [{ name: 'regionCount', value: '4', line: 8, type: 'int' }],
    [client, ...makeRegions()],
    [
      { from: 'client', to: 'region-0', label: '分区键' },
      { from: 'region-0', to: 'region-3', label: '范围递增' },
    ],
    'OVERVIEW',
    'Region 分布'
  )

  // 步骤 1：顺序 RowKey（自增 id）
  push(
    '顺序 RowKey（自增 id）单调递增，新 key 总是最大，全部写入最后一个 Region',
    4,
    [
      { name: 'rawKey', value: 'id=1001,1002,1003...', line: 4, type: 'seq' },
      { name: '热点Region', value: 'Region 3', line: 4 },
    ],
    [
      { ...client, state: 'active' },
      ...makeRegions().map((r, i) =>
        i === 3 ? { ...r, state: 'hot' } : r
      ),
      keyNode(3, 0, '1001', true),
      keyNode(3, 1, '1002', true),
      keyNode(3, 2, '1003', true),
      keyNode(3, 3, '1004', true),
    ],
    [{ from: 'client', to: 'region-3', label: '全部打到此处' }],
    'SEQUENTIAL',
    '顺序 RowKey 热点'
  )

  // 步骤 2：热点后果
  push(
    'Region 3 成为热点：CPU/IO 单点压力，写入吞吐被单 Region 限制，其它 Region 闲置',
    4,
    [
      { name: '热点', value: 'Region 3 (load↑↑)', line: 4 },
      { name: 'Region0-2', value: 'idle', line: 4 },
    ],
    [
      { ...client, state: 'idle' },
      ...makeRegions().map((r, i) =>
        i === 3 ? { ...r, state: 'hot', label: 'Region 3 (热点)' } : r
      ),
      keyNode(3, 0, '1001', true),
      keyNode(3, 1, '1002', true),
      keyNode(3, 2, '1003', true),
    ],
    [],
    'HOTSPOT',
    '热点后果'
  )

  // 步骤 3：加盐 salting
  push(
    '加盐：前缀 = hashCode(key) % regionCount，相同原始 key 也会分散到不同 Region',
    9,
    [
      { name: 'rawKey', value: 'user123', line: 2 },
      { name: 'prefix', value: '3 (hash%4)', line: 9, type: 'int' },
      { name: 'saltedKey', value: '3_user123', line: 11, type: 'byte[]' },
    ],
    [
      { ...client, state: 'active' },
      ...makeRegions(),
      keyNode(3, 4, '3_user123'),
    ],
    [{ from: 'client', to: 'region-3', label: 'salt=3' }],
    'SALT',
    '加盐'
  )

  // 步骤 4：加盐分布统计
  push(
    '加盐后写入均匀分散到 4 个 Region，无热点；代价：范围扫描需扫所有 Region 再合并',
    11,
    [
      { name: 'saltedKey', value: '3_user123', line: 11 },
      { name: '分布', value: '每Region≈25%', line: 11 },
    ],
    [
      { ...client, state: 'idle' },
      ...makeRegions(),
      keyNode(0, 0, '0_user7'),
      keyNode(1, 0, '1_user42'),
      keyNode(2, 0, '2_user99'),
      keyNode(3, 4, '3_user123'),
    ],
    [],
    'SALT_DIST',
    '加盐分布'
  )

  // 步骤 5：哈希 hash
  push(
    '哈希：整键取 MD5 前缀做分区键，分布均匀；缺点：完全失去原始顺序，范围查询不可用',
    13,
    [
      { name: 'rawKey', value: 'user123', line: 2 },
      { name: 'hashedKey', value: 'a1b2...(MD5)', line: 13, type: 'byte[]' },
    ],
    [
      { ...client, state: 'active' },
      ...makeRegions(),
      keyNode(0, 1, 'MD5#...'),
      keyNode(1, 1, 'MD5#...'),
      keyNode(2, 1, 'MD5#...'),
      keyNode(3, 5, 'MD5#...'),
    ],
    [],
    'HASH',
    '哈希'
  )

  // 步骤 6：反转 reverse
  push(
    '反转：reverse("user123") = "321resu"，把高位变化部分移到前缀低位，打散连续热点',
    15,
    [
      { name: 'rawKey', value: 'user123', line: 2 },
      { name: 'reversedKey', value: '321resu', line: 15, type: 'byte[]' },
    ],
    [
      { ...client, state: 'active' },
      ...makeRegions(),
      keyNode(0, 2, '321resu'),
    ],
    [{ from: 'client', to: 'region-0', label: 'reverse→低位' }],
    'REVERSE',
    '反转'
  )

  // 步骤 7：对比总结
  push(
    '对比：顺序=热点；加盐/哈希=分散但牺牲范围扫描；反转=缓解单调热点但保留部分前缀',
    18,
    [
      { name: '策略', value: 'salt/hash/reverse', line: 18 },
      { name: '热点', value: '已消除', line: 18 },
      { name: '范围扫描', value: '受限', line: 18 },
    ],
    [
      { ...client, state: 'idle' },
      ...makeRegions().map((r) => ({ ...r, state: 'done' })),
      keyNode(0, 3, '分散'),
      keyNode(1, 2, '分散'),
      keyNode(2, 2, '分散'),
      keyNode(3, 6, '分散'),
    ],
    [],
    'COMPARE',
    '策略对比'
  )

  // 步骤 8：写入决策
  push(
    '选定策略后写入：Put 用处理后的 key，分区键决定 Region 路由',
    21,
    [
      { name: 'put', value: 'Put(3_user123)', line: 21, type: 'Put' },
      { name: 'target', value: 'Region 3', line: 21 },
    ],
    [
      { ...client, state: 'active' },
      ...makeRegions().map((r, i) =>
        i === 3 ? { ...r, state: 'active' } : r
      ),
      keyNode(3, 7, '3_user123'),
    ],
    [{ from: 'client', to: 'region-3', label: 'route' }],
    'PUT',
    '写入决策'
  )

  return steps
}
