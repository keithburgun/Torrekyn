using UnityEngine;

public class GameController : MonoBehaviour
{
    public static GameController instance;

    public Card currentlyDraggingCard;
    public DeckManager deckManager;
    public CardDatabase cardDatabase;

    public void Awake()
    {
        instance = this; 
    }

    public static GameController game
    {
        get
        {
            return instance;
        }
    }

    public enum GameState
    {
        PlayerTurnState,
        ActionState,
        PausedState,
        MenuState
    }

    public GameState gameState;

    public void Start()
    {
        cardDatabase.InitializeAllCardDataFromCSV();
        BeginMatch();
    }

    void BeginMatch()
    {
        deckManager.InitializeDeck(cardDatabase.GetStartingDeck());

        ChangeGameState(GameState.PlayerTurnState);

    }

    void ChangeGameState(GameState newState)
    {
        gameState = newState;
        switch (gameState)
        {
            case GameState.PlayerTurnState:
                // Handle player turn state
                break;
            case GameState.ActionState:
                // Handle action state
                break;
            case GameState.PausedState:
                // Handle paused state
                break;
            case GameState.MenuState:
                // Handle menu state
                break;
        }
    }

    public void DragCard(Card cardDragging)
    {
        currentlyDraggingCard = cardDragging;
    }

    public void DropCard(Vector2 position)
    {

    }

    public void FixedUpdate()
    {
        
    }
}
