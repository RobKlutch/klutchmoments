import PlayerSelection from '../PlayerSelection';

export default function PlayerSelectionExample() {
  const handlePlayerSelect = (x: number, y: number) => {
    console.log('Player selected in example at:', x, y);
  };

  return (
    <div className="max-w-4xl mx-auto p-4">
      <PlayerSelection onPlayerSelect={handlePlayerSelect} />
    </div>
  );
}