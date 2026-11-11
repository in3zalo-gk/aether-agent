import React,{Component} from 'react'
import ReactDOM from 'react-dom/client'
import App,{ErrorBoundaryFallback} from './App.jsx'
import './index.css'
class ErrorBoundary extends Component{
 state={failed:false}
 static getDerivedStateFromError(){return {failed:true}}
 render(){return this.state.failed?<ErrorBoundaryFallback/>:this.props.children}
}
ReactDOM.createRoot(document.getElementById('root')).render(<React.StrictMode><ErrorBoundary><App/></ErrorBoundary></React.StrictMode>)
if('serviceWorker' in navigator&&import.meta.env.PROD){window.addEventListener('load',()=>{navigator.serviceWorker.register('/sw.js').catch(()=>{})})}
