export const toolDefinitions = [
  { type:'function', function:{ name:'run_termux_command', description:'Executa um comando autorizado no ambiente local de testes.', parameters:{ type:'object', properties:{ command:{ type:'string', description:'Comando a executar.' } }, required:['command'], additionalProperties:false } } },
  { type:'function', function:{ name:'open_browser', description:'Inicia uma sessão de navegador para testes autorizados.', parameters:{ type:'object', properties:{}, additionalProperties:false } } },
  { type:'function', function:{ name:'inject_javascript', description:'Executa JavaScript na página atual do navegador autorizado.', parameters:{ type:'object', properties:{ script:{ type:'string', description:'Script a executar.' } }, required:['script'], additionalProperties:false } } },
  { type:'function', function:{ name:'navigate_browser', description:'Navega o navegador para uma URL.', parameters:{ type:'object', properties:{ url:{ type:'string', format:'uri', description:'URL HTTP(S) de destino.' } }, required:['url'], additionalProperties:false } } }
]
