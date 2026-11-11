const paths = {
 menu: 'M4 6h16M4 12h16M4 18h16', plus: 'M12 5v14M5 12h14', close: 'M6 6l12 12M6 18L18 6',
 arrow: 'M12 19V5m-6 6 6-6 6 6', chevron: 'm9 5 7 7-7 7', down: 'm6 9 6 6 6-6',
 chat: 'M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z',
 settings: 'M9 3h6l1 4 4 1v8l-4 1-1 4H9l-1-4-4-1V8l4-1 1-4ZM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z',
 terminal: 'm5 7 5 5-5 5m8 0h6', sparkle: 'm12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z',
 code: 'm8 6-6 6 6 6m8-12 6 6-6 6m-3-15-2 18', globe: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z',
 shield: 'm12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Zm-4 9 3 3 5-6',
 heart: 'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z',
 copy: 'M9 9h12v12H9zM15 5V3H3v12h2', check: 'm5 12 4 4L19 6', trash: 'M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7',
 stop: 'M6 6h12v12H6z', refresh: 'M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 13 2M5 16a8 8 0 0 0 13 2',
 cloud: 'M6 18a5 5 0 0 1-1-10 7 7 0 0 1 13-1 5.5 5.5 0 0 1 0 11H6Z', offline: 'm3 3 18 18M9 5a7 7 0 0 1 10 5 4 4 0 0 1 1 7M5 8a5 5 0 0 0 1 10h9',
 download: 'M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4', search:'m21 21-6-6M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z'
}
export default function Icon({name,size=20,...props}) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}><path d={paths[name] || paths.sparkle}/></svg> }
export function Brand({small=false}) { return <span className={'brand '+(small?'brand-small':'')}><span className="brand-symbol" aria-hidden="true"><svg viewBox="0 0 32 32"><path d="m16 4 12 23H4L16 4Z" fill="none" stroke="currentColor" strokeWidth="1.7"/><path d="M10 20h12M16 4v14" fill="none" stroke="currentColor" strokeWidth="1.3"/></svg></span>{!small&&<span>Aether<span className="brand-dot">.</span></span>}</span> }
