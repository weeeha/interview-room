import { useParams } from "react-router-dom";

export function Report() {
  const { id } = useParams();
  return (
    <main>
      <h1>Report</h1>
      <p>Session {id}</p>
    </main>
  );
}
