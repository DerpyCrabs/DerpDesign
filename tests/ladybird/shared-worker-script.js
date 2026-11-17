fetch('/report?event=worker-started');
onconnect=event=>{event.ports[0].postMessage('worker ready');};
