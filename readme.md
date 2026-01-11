# Leitor Infinito de Manga

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Um userscript que transforma a experiência de leitura em sites de mangas, oferecendo rolagem infinita, histórico de leitura, rolagem automática e uma interface minimalista.

## Funcionalidades

- **Rolagem Infinita**: Carrega automaticamente o próximo capítulo enquanto você rola a página, permitindo uma leitura contínua e sem interrupções.
- **Carregamento Otimizado**: Lazy loading de imagens para economia de dados e carregamento mais rápido.
- **Rolagem Automática**: Ative a rolagem automática com duas velocidades ajustáveis (lenta e rápida).
- **Histórico de Leitura**: Salva o progresso de cada manga localmente, incluindo o último capítulo lido e o link direto para retomar a leitura.
- **Interface Minimalista**: Remove anúncios e elementos desnecessários, focando apenas na leitura do manga, para uma experiência limpa e imersiva.
- **Biblioteca de Mangas**: Modal para gerenciar o histórico de leitura, com links diretos para capítulos salvos e opção de exclusão.
- **Compatibilidade com Mobile**: Gestos de toque otimizados para dispositivos móveis.

## Screenshots

### Desktop
![Modo de Leitura Desktop](screenshots/desktop-1.png)
![Modo de Leitura Desktop](screenshots/desktop-2.png)

### Mobile
<table>
  <tr>
    <td><img src="screenshots/mobile-1.png" alt="Leitura" width="250"/></td>
    <td><img src="screenshots/mobile-2.png" alt="Biblioteca" width="250"/></td>
  </tr>
</table>

## Instalação

### Desktop
1. Instale um gerenciador de userscripts no seu navegador:
   - [Tampermonkey](https://www.tampermonkey.net/) (recomendado para Chrome, Firefox, Safari e outros).
   - [Greasemonkey](https://www.greasespot.net/) (para Firefox).
   - [Violentmonkey](https://violentmonkey.github.io/) (alternativa moderna).

2. Baixe o arquivo `manga-reader.user.js` deste repositório.

3. Abra o arquivo no navegador ou arraste-o para o painel do gerenciador de userscripts para instalar.

4. O script será ativado automaticamente para os sites configurados.

### Mobile (Android/iOS)
Userscripts têm suporte limitado em dispositivos móveis devido a restrições dos navegadores.

#### Android
1. Use o navegador Firefox para Android (disponível na Google Play Store).
2. Instale a extensão [Tampermonkey](https://www.tampermonkey.net/) no Firefox.
3. Baixe o arquivo `manga-reader.user.js` neste dispositivo.
4. Abra o arquivo no Firefox e instale-o via Tampermonkey.
5. O script será ativado automaticamente para os sites configurados (apenas no Firefox).

#### iOS
1. Baixe o app [Userscripts](https://apps.apple.com/app/userscripts/id1463298887) (disponível na App Store).
2. Abra o app Userscripts (já vem com uma pasta padrão configurada).
3. Baixe o arquivo `manga-reader.user.js` deste repositório.
4. Mova o arquivo para a pasta do Userscripts.
5. Ative a extensão Userscripts no Safari (Configurações > Safari > Extensões).
6. Dê permissão ao Userscripts para todos os sites (Configurações > Safari > Extensões > UserScripts > Outros Sites > Permitir).
7. O script será ativado automaticamente para os sites configurados (apenas no Safari).

## Como Usar

O script funciona de forma otimizada para desktop e mobile, com controles adaptados para cada plataforma. Abaixo, as instruções específicas para cada funcionalidade:

### Desktop
- **Rolagem Infinita**: Basta rolar a página para que o próximo capítulo seja carregado automaticamente.
- **Rolagem Automática**: Clique no botão flutuante de "Play/Setas" (canto inferior esquerdo) para ativar/desativar. Use o clique direito para alternar entre velocidades lenta e rápida.
- **Histórico de Leitura**: O progresso é salvo automaticamente. Clique no botão "Livro" (canto inferior esquerdo, tanto no modo leitura, como na navegação normal no site de manga) para abrir a biblioteca e acessar os capítulos salvos.
- **Interface Minimalista**: A interface é limpa automaticamente. *Clique em qualquer área vazia para ocultar/mostrar os botões flutuantes.*

### Mobile (Android/iOS)
- **Rolagem Infinita**: Funciona automaticamente ao rolar a página.
- **Rolagem Automática**: Toque no botão flutuante de "Play/Setas" (canto inferior esquerdo) para ativar/desativar. Use toque duplo para alternar entre velocidades lenta e rápida.
- **Histórico de Leitura**: O progresso é salvo automaticamente. Toque no botão "Livro" para abrir a biblioteca e acessar os capítulos salvos.
- **Interface Minimalista**: A interface é limpa automaticamente. *Toque em qualquer área vazia para ocultar/mostrar os botões flutuantes.*

## Compatibilidade

- Compatível com MangaLivre e clones que imitem o layout original (basta adicionar o domínio no script e testar a compatibilidade).
- Funciona em navegadores desktop e mobile.
- Requer JavaScript ativado.

## Observações

- Os dados de progresso são salvos localmente no navegador (localStorage).
- Se o layout do site mudar, pode ser necessário atualizar os seletores de imagem no código.
- Não há dependências externas além do Font Awesome para os ícones.

## Licença

Este projeto é distribuído sob a licença MIT. Veja o arquivo [LICENSE](LICENSE) para mais detalhes.
