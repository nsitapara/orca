import { describe, expect, it } from 'vitest'
import type { WorkspacePort } from '../../../../../shared/workspace-ports'
import { buildStackPorts, stackPortLabel } from './stack-ports'

function live(port: number, processName = 'node', bindHost = '127.0.0.1'): WorkspacePort {
  return {
    kind: 'external',
    id: `${bindHost}:${port}`,
    bindHost,
    connectHost: 'localhost',
    port,
    processName,
    protocol: 'http'
  }
}

// web-platform's shape: ports in stack order, then the URLs the portals use.
const ENV = `API_PORT=8001
DB_PORT=5433
REDIS_PORT=6380
S3_PORT=8334
CUSTOMER_PORT=3004
STAFF_PORT=3005
CLINICIAN_PORT=3006
SECRET_TOKEN=abc123
API_URL=http://localhost:8001
VITE_CUSTOMER_PORTAL_URL=http://127.0.0.1:3004
CUSTOMER_PORTAL_URL=http://localhost:3004
STAFF_PORTAL_URL=http://localhost:3005
CLINICIAN_PORTAL_URL="http://localhost:3006" # quoted
`

describe('stackPortLabel', () => {
  it.each([
    ['DB_PORT', 'DB'],
    ['S3_PORT', 'S3'],
    ['API_PORT', 'API'],
    ['REDIS_PORT', 'Redis'],
    ['CUSTOMER_PORTAL_PORT', 'Customer Portal']
  ])('%s → %s', (envVar, label) => {
    expect(stackPortLabel(envVar)).toBe(label)
  })
})

describe('buildStackPorts', () => {
  it('lists live declared ports web pages first, then the API, then the rest, each in file order', () => {
    const ports = [
      live(5433, 'postgres', '::1'),
      live(5433, 'postgres'),
      live(6380, 'redis-server'),
      live(8001, 'python3.13'),
      live(8334, 'weed'),
      live(18334, 'weed'),
      live(3005),
      live(3004)
    ]
    const { stack, others } = buildStackPorts(ENV, ports)
    expect(stack.map((p) => [p.label, p.port, p.url])).toEqual([
      ['Customer', 3004, 'http://localhost:3004'],
      ['Staff', 3005, 'http://localhost:3005'],
      ['API', 8001, 'http://localhost:8001'],
      ['DB', 5433, null],
      ['Redis', 6380, null],
      ['S3', 8334, null]
    ])
    expect(others.map((p) => p.port)).toEqual([18334])
  })

  it('has no stack when the file declares nothing live', () => {
    expect(buildStackPorts('# empty\n', [live(3000)])).toEqual({ stack: [], others: [live(3000)] })
  })
})
