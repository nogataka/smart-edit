interface Props {
  totalCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
}

export function SummaryTable({ totalCalls, totalInputTokens, totalOutputTokens }: Props) {
  return (
    <table className="stats-summary">
      <thead>
        <tr>
          <th>Metric</th>
          <th>Total</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Tool Calls</td>
          <td>{totalCalls}</td>
        </tr>
        <tr>
          <td>Input Tokens</td>
          <td>{totalInputTokens}</td>
        </tr>
        <tr>
          <td>Output Tokens</td>
          <td>{totalOutputTokens}</td>
        </tr>
        <tr>
          <td>Total Tokens</td>
          <td>{totalInputTokens + totalOutputTokens}</td>
        </tr>
      </tbody>
    </table>
  );
}
