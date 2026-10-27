// Tiny illustrations shown in tooltips: what a control looks like on the graph.
// Drawn with the theme colours so they match whatever theme is active.

import type { ReactNode } from 'react'

const REF = 'M6 40 H44 C54 40 54 22 64 22 H104 C114 22 114 32 124 32 H194'

function Box({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 200 56" className="block w-full h-auto" aria-hidden>
      {children}
    </svg>
  )
}
const ref = (o = 0.5) => <path d={REF} fill="none" stroke="var(--text)" strokeOpacity={o} strokeWidth="3.5" strokeLinecap="round" />
const you = (d: string, o = 1) => <path d={d} fill="none" stroke="var(--voice)" strokeOpacity={o} strokeWidth="3" strokeLinecap="round" />

export const PREVIEW = {
  shapeLine: (
    <Box>
      {ref()}
      {you('M6 41 H44 C54 41 54 23 64 23 H104 C114 23 114 33 124 33 H160')}
      <text x="166" y="52" fill="var(--sub)" fontSize="9">any key</text>
    </Box>
  ),
  exactLine: (
    <Box>
      {ref()}
      {you('M6 52 H44 C54 52 54 40 64 40 H104 C114 40 114 48 124 48 H160', 0.9)}
      <text x="150" y="16" fill="var(--sub)" fontSize="9">real pitch</text>
    </Box>
  ),
  loudness: (
    <Box>
      <rect x="0" y="8" width="200" height="40" rx="4" fill="var(--sub-alt)" />
      {[[10, 30], [40, 22], [70, 14], [100, 18], [130, 28], [160, 34]].map(([x, y]) => (
        <rect key={x} x={x} y={y} width="26" height={48 - y} fill="var(--sub)" fillOpacity=".6" />
      ))}
      <path d="M10 33 C30 30 50 20 70 17 S110 20 130 30 S170 36 186 37" fill="none" stroke="var(--text)" strokeWidth="2" />
    </Box>
  ),
  timing: (
    <Box>
      {ref()}
      {[44, 124].map((x) => <line key={x} x1={x} x2={x} y1="6" y2="52" stroke="var(--sub)" strokeDasharray="2 4" />)}
      <path d="M64 48 H74 M74 45 V51" stroke="var(--sharp)" strokeWidth="2" />
      <path d="M124 48 H118 M118 45 V51" stroke="var(--flat)" strokeWidth="2" />
    </Box>
  ),
  smooth: <Box>{ref(0.35)}{you('M6 41 C30 41 40 40 50 34 S60 23 70 23 H100 C112 23 114 33 124 33 H194')}</Box>,
  natural: <Box>{ref(0.35)}{you('M6 41 Q14 38 22 41 T38 41 C50 41 52 23 64 23 Q72 20 80 23 T96 23 Q104 26 112 23 C118 23 118 33 124 33 Q132 30 140 33 T156 33 T172 33 T194 33')}</Box>,
  detailed: <Box>{ref(0.35)}{you('M6 41 L10 38 L13 43 L17 39 L21 42 L25 37 L29 42 L33 40 L37 43 L42 39 L48 34 L54 27 L60 24 L64 21 L68 25 L72 21 L76 24 L80 20 L84 25 L88 22 L92 24 L96 21 L100 25 L106 23 L112 29 L118 33 L122 30 L126 35 L130 31 L134 34 L138 30 L142 35 L146 32 L150 34 L156 31 L162 35 L168 32 L174 34 L182 31 L194 33')}</Box>,
  level: (w: number) => (
    <Box>
      <path d={REF} fill="none" stroke="var(--main)" strokeOpacity=".18" strokeWidth={w} strokeLinejoin="round" />
      {ref(0.7)}
      <text x="140" y="14" fill="var(--sub)" fontSize="9">on the line</text>
    </Box>
  ),
  shapeMode: (
    <Box>
      {ref()}
      {you('M6 52 H44 C54 52 54 34 64 34 H104 C114 34 114 44 124 44 H160', 0.9)}
      <path d="M176 44 V30 M171 35 L176 30 L181 35" stroke="var(--sub)" strokeWidth="1.5" fill="none" />
      <text x="140" y="14" fill="var(--sub)" fontSize="9">shape counts</text>
    </Box>
  ),
  exactMode: (
    <Box>
      {ref()}
      {you('M6 40 H44 C54 40 54 22 64 22 H104 C114 22 114 32 124 32 H160')}
      <text x="142" y="14" fill="var(--sub)" fontSize="9">same notes</text>
    </Box>
  ),
  loop: (
    <Box>
      <rect x="40" y="4" width="110" height="48" rx="3" fill="var(--sub-alt)" />
      <rect x="39" y="4" width="2" height="48" fill="var(--main)" fillOpacity=".6" />
      <rect x="149" y="4" width="2" height="48" fill="var(--main)" fillOpacity=".6" />
      {ref()}
      <path d="M140 12 C150 2 160 12 150 18 M150 18 L146 12 M150 18 L156 15" fill="none" stroke="var(--main)" strokeWidth="1.5" />
    </Box>
  ),
  metronome: (
    <Box>
      {ref(0.35)}
      {[20, 60, 100, 140, 180].map((x, i) => <rect key={x} x={x - 1} y={i === 0 ? 4 : 10} width="2" height={i === 0 ? 48 : 36} fill="var(--sub)" fillOpacity={i === 0 ? 0.7 : 0.35} />)}
    </Box>
  ),
  breath: (
    <Box>
      {ref()}
      <path d="M110 4 L118 4 L114 11 Z" fill="var(--main)" />
      <line x1="114" x2="114" y1="13" y2="52" stroke="var(--main)" strokeOpacity=".5" strokeDasharray="3 4" />
    </Box>
  ),
  key: (
    <Box>
      {ref(0.25)}
      <path d="M6 30 H44 C54 30 54 12 64 12 H104 C114 12 114 22 124 22 H194" fill="none" stroke="var(--text)" strokeOpacity=".7" strokeWidth="3.5" strokeLinecap="round" />
      <path d="M180 44 V26 M175 31 L180 26 L185 31" stroke="var(--main)" strokeWidth="1.5" fill="none" />
    </Box>
  ),
  delay: (
    <Box>
      <path d={REF} fill="none" stroke="var(--text)" strokeOpacity=".25" strokeWidth="3" strokeLinecap="round" strokeDasharray="4 5" />
      <path d="M22 40 H60 C70 40 70 22 80 22 H120 C130 22 130 32 140 32 H194" fill="none" stroke="var(--text)" strokeOpacity=".7" strokeWidth="3.5" strokeLinecap="round" />
      {you('M22 41 H60 C70 41 70 23 80 23 H120 C130 23 130 33 140 33 H190')}
      <path d="M50 10 H72 M66 6 L72 10 L66 14" stroke="var(--main)" strokeWidth="1.5" fill="none" />
    </Box>
  ),
  speed: (
    <Box>
      <path d="M6 22 H30 C36 22 36 12 42 12 H66 C72 12 72 18 78 18 H100" fill="none" stroke="var(--text)" strokeOpacity=".35" strokeWidth="3" strokeLinecap="round" />
      <path d="M6 46 H46 C56 46 56 32 66 32 H106 C116 32 116 40 126 40 H194" fill="none" stroke="var(--text)" strokeOpacity=".7" strokeWidth="3.5" strokeLinecap="round" />
      <text x="110" y="16" fill="var(--sub)" fontSize="9">slower, same pitch</text>
    </Box>
  ),
}
