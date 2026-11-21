import { useParams } from "react-router-dom";

export function Room() {
  const { id } = useParams();
  return (
    <main>
      <h1>Room</h1>
      <p>Session {id}</p>
    </main>
  );
}
