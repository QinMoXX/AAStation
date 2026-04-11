import { ReactFlowProvider } from 'reactflow';
import FlowCanvas from './components/canvas/FlowCanvas';

function App() {
  return (
    <ReactFlowProvider>
      <div style={{ width: '100vw', height: '100vh' }}>
        <FlowCanvas />
      </div>
    </ReactFlowProvider>
  );
}

export default App;
