export function FlowHeading({ title, subtitle, current, next }: {
  title: string; subtitle: string; current?: string; next?: string
}) {
  return (
    <div className="flow-heading">
      <div><h1>{title}</h1><p>{subtitle}</p></div>
      {current && <div className="flow-progress" aria-label={`${current}, followed by ${next}`}>
        <span aria-current="step"><b aria-hidden="true" />{current}</span>{next && <><i aria-hidden="true" /><span>{next}</span></>}
      </div>}
    </div>
  )
}
