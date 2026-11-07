import React from 'react'
import { fmtAmt, pct, cls } from '../lib/format'

/**
 * Sector board: a heat-ranked list of concept clusters, each opening into a
 * dossier with its leaders, board ladder and full member table.
 *
 * Membership matches the concept filter used elsewhere, so a sector's 家数 is
 * always exactly what filtering by that concept returns.
 */
export function SectorGrid({ sectors, onSelect }) {
  if (!sectors) return <div className="empty">加载中…</div>
  if (!sectors.length) return <div className="empty">当前无可聚合的板块</div>

  return (
    <div className="sec-grid">
      {sectors.map((s) => (
        <button className="sec-card" key={s.name} onClick={() => onSelect(s.name)}>
          <div className="sc-head">
            <b>{s.name}</b>
            <span className={`sc-heat${s.heat >= 80 ? ' hot' : ''}`}>{s.heat}</span>
          </div>
          <div className="sc-bar"><i style={{ width: `${Math.min(100, s.heat)}%` }} /></div>
          <div className="sc-meta">
            <span>{s.n} 家</span>
            <span>最高 {s.maxBoard} 板</span>
            <span>连板 {s.lianban}</span>
            <span className={cls(s.avgChg)}>{pct(s.avgChg)}</span>
          </div>
          <div className="sc-leaders">
            {s.leaders.map((l) => (
              <span key={l.code} className="sc-leader">
                {l.name}
                <em>{l.boards >= 2 ? `${l.boards}板` : '首板'}</em>
              </span>
            ))}
          </div>
          <div className="sc-ladder">
            {s.ladder.map((g) => (
              <span key={g.board}>{g.label}×{g.list.length}</span>
            ))}
          </div>
        </button>
      ))}
    </div>
  )
}

export function SectorDetail({ sector, onBack, onOpen }) {
  if (!sector) return null

  return (
    <div className="sec-detail">
      <div className="sd-head">
        <button className="sd-back" onClick={onBack}>‹ 板块榜</button>
        <h3>{sector.name}</h3>
        <span className={`sc-heat${sector.heat >= 80 ? ' hot' : ''}`}>{sector.heat}</span>
      </div>

      <div className="mgrid sd-stats">
        <div><div className="k">涨停家数</div><div className="v">{sector.n}</div></div>
        <div><div className="k">最高板</div><div className="v">{sector.maxBoard}</div></div>
        <div><div className="k">连板家数</div><div className="v">{sector.lianban}</div></div>
        <div><div className="k">平均涨幅</div><div className={`v ${cls(sector.avgChg)}`}>{pct(sector.avgChg)}</div></div>
        <div><div className="k">封单合计</div><div className="v">{fmtAmt(sector.sealAmt)}</div></div>
        <div><div className="k">梯队层数</div><div className="v">{sector.ladder.length}</div></div>
      </div>

      <div className="sec-t">龙头 · 助攻</div>
      <div className="sd-leaders">
        {sector.leaders.map((l, i) => (
          <button className="sd-leader" key={l.code} onClick={() => onOpen(l.code)}>
            <span className="sdl-rk">{i === 0 ? '龙头' : i === 1 ? '助攻' : '跟风'}</span>
            <b>{l.name}</b>
            <span className="sdl-code">{l.code}</span>
            <span className="sdl-boards">{l.boards >= 2 ? `${l.boards}连板` : '首板'}</span>
            <span className={cls(l.chg)}>{pct(l.chg)}</span>
            <span className="sdl-score">{l.score.toFixed(0)}分</span>
          </button>
        ))}
      </div>

      <div className="sec-t">连板梯队</div>
      <div className="sd-ladder">
        {sector.ladder.map((g) => (
          <div className="rung" key={g.board}>
            <div className="h">{g.label}<small>{g.list.length} 只</small></div>
            <div className="b">
              {g.list.map((s) => (
                <button
                  key={s.code}
                  className="stockchip"
                  onClick={() => onOpen(s.code)}
                  title={`${s.name} ${pct(s.chg)}`}
                >
                  <b>{s.name || s.code}</b>
                  <em className={cls(s.chg)}>{pct(s.chg)}</em>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="sec-t">板块成员<span className="sec-note">{sector.n} 只</span></div>
      <div className="tbl-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col" className="l">代码</th><th scope="col" className="l">名称</th>
              <th scope="col">连板</th><th scope="col">涨幅</th><th scope="col">封单</th><th scope="col">评分</th>
            </tr>
          </thead>
          <tbody>
            {sector.members.map((m) => (
              <tr key={m.code} onClick={() => onOpen(m.code)}>
                <td className="l"><span className="code">{m.code}</span></td>
                <td className="l"><b>{m.name}</b>{m.boardType ? <em className="bt">{m.boardType}</em> : null}</td>
                <td>{m.boards >= 2 ? `${m.boards}板` : '首板'}</td>
                <td className={cls(m.chg)}>{pct(m.chg)}</td>
                <td>{fmtAmt(m.sealAmt)}</td>
                <td>{m.score.toFixed(0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
