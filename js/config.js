/*
 * CONFIGURAÇÃO DO APP — este é o único arquivo que você precisa editar.
 *
 * 1) firebase: cole aqui o objeto "firebaseConfig" do seu projeto Firebase
 *    (Console do Firebase → Configurações do projeto → Seus apps → Web).
 *    Enquanto ficar null, o app roda em MODO LOCAL: sem login e com os dados
 *    salvos só no navegador de quem abriu. Serve apenas para testar.
 *
 * 2) regionais: para incluir uma regional nova, copie uma linha e ajuste.
 *    O "id" nunca deve mudar depois que houver chips cadastrados nele.
 *
 * 3) operadoras: o "id" é o nome em minúsculas. O logo fica em assets/logos.
 */
window.APP_CONFIG = {
  firebase: null,
  /* Exemplo de como fica preenchido:
  firebase: {
    apiKey: "AIzaSy...",
    authDomain: "controle-chips-remotas.firebaseapp.com",
    projectId: "controle-chips-remotas",
    storageBucket: "controle-chips-remotas.appspot.com",
    messagingSenderId: "123456789012",
    appId: "1:123456789012:web:abc123def456"
  },
  */

  titulo: "Controle de Chips das Remotas",
  setor: "Executiva de Perdas · Sul e Sudoeste",
  area: "Telemetria · Grupo A",

  regionais: [
    { id: "ipora",       nome: "Iporá",                    curto: "Iporá",        sup: "Sudoeste", cidades: ["Iporá", "Amorinópolis", "Israelândia", "Jaupaci", "Diorama", "Arenópolis"] },
    { id: "montesbelos", nome: "São Luís de Montes Belos", curto: "Montes Belos", sup: "Sudoeste", cidades: ["São Luís de Montes Belos", "Firminópolis", "Sanclerlândia", "Turvânia", "Aurilândia", "Córrego do Ouro"] },
    { id: "morrinhos",   nome: "Morrinhos",                curto: "Morrinhos",    sup: "Sul",      cidades: ["Morrinhos", "Goiatuba", "Pontalina", "Buriti Alegre", "Joviânia"] },
    { id: "rioverde",    nome: "Rio Verde",                curto: "Rio Verde",    sup: "Sul",      cidades: ["Rio Verde", "Santa Helena de Goiás", "Montividiu", "Acreúna", "Maurilândia"] }
  ],

  operadoras: [
    { id: "vivo",  nome: "Vivo",  cor: "#7B2CBF", logo: "assets/logos/vivo.png" },
    { id: "claro", nome: "Claro", cor: "#D52B1E", logo: "assets/logos/claro.png" },
    { id: "tim",   nome: "TIM",   cor: "#1F4FBF", logo: "assets/logos/tim.png" },
    { id: "oi",    nome: "Oi",    cor: "#2E9E1F", logo: "assets/logos/oi.png", alturaLogo: 20 },
    { id: "algar", nome: "Algar", cor: "#0B6FB0", logo: "assets/logos/algar.png" }
  ],

  /* Dias até um chip virar pendência */
  limites: { retiradoDias: 7, equipeDias: 15 }
};
